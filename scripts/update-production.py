#!/usr/bin/env python3
"""Actualizar una instalación existente desde consola, conservando datos y secretos."""
import argparse
import datetime
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def run(args, capture=False, output=None, env=None):
    result = subprocess.run(args, check=True, env=env, stdout=output or (subprocess.PIPE if capture else None),
                            stderr=subprocess.PIPE if capture else None)
    return result.stdout.decode().strip() if capture else None


def inspect(name):
    return json.loads(run(['docker', 'inspect', name], capture=True))[0]


def environment(container):
    return dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)


def write_json(path, value):
    if path.name.startswith('compose.'):
        # Compose vuelve a interpolar el JSON: conservar también claves con dólares.
        def literal(item):
            if isinstance(item, str):
                return item.replace('$', '$$')
            if isinstance(item, list):
                return [literal(v) for v in item]
            if isinstance(item, dict):
                return {k: literal(v) for k, v in item.items()}
            return item
        value = literal(value)
    path.write_text(json.dumps(value, indent=2), encoding='utf8')
    path.chmod(0o600)


def update(options):
    os.umask(0o077)
    root = Path(options.directory).resolve(strict=True)
    if not root.is_dir():
        raise RuntimeError('La ruta del proyecto no es una carpeta.')
    import fcntl
    lock = (root / '.update.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    project = options.project
    containers = {service: inspect(f'{project}-{service}-1') for service in ['db', 'api', 'web']}
    for service, container in containers.items():
        labels = container['Config'].get('Labels') or {}
        if labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.service') != service:
            raise RuntimeError('Los contenedores no pertenecen al proyecto solicitado.')
        if not container['State']['Running']:
            raise RuntimeError(f'El servicio {service} debe estar en ejecución antes de actualizar.')

    mounts = {'db': {'/var/lib/postgresql/data': 'pgdata'}, 'api': {'/data/uploads': 'uploads'},
              'web': {'/data': 'caddy_data', '/config': 'caddy_config'}}
    volume_names = {}
    for service, destinations in mounts.items():
        for destination, key in destinations.items():
            mount = next((m for m in containers[service]['Mounts'] if m['Destination'] == destination), None)
            if not mount or mount['Type'] != 'volume':
                raise RuntimeError(f'No se reconoce el volumen de {service}: {destination}. No se ha actualizado nada.')
            volume_names[key] = mount['Name']

    common = set.intersection(*(set(c['NetworkSettings']['Networks']) for c in containers.values()))
    network = project + '_backend'
    if network not in common:
        raise RuntimeError('La red del proyecto no coincide. Revisar la instalación antes de actualizar.')
    bindings = containers['web']['HostConfig'].get('PortBindings') or {}
    ports = bindings.get('80/tcp') or []
    if set(bindings) != {'80/tcp'} or len(ports) != 1:
        raise RuntimeError('Se esperaba un único puerto HTTP publicado. No se cambió la configuración.')
    host_ip = ports[0]['HostIp'] or '0.0.0.0'
    active_ports = containers['web']['NetworkSettings']['Ports'].get('80/tcp') or []
    active = next((p for p in active_ports if p['HostIp'] == host_ip), None)
    if not active:
        raise RuntimeError('No se pudo comprobar el puerto HTTP activo.')
    host_port = active['HostPort']
    if host_port in ['80', '443']:
        raise RuntimeError('Este actualizador requiere un puerto independiente de 80/443.')

    api_env, db_env = environment(containers['api']), environment(containers['db'])
    required = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']
    if any(not api_env.get(key) for key in required) or not db_env.get('POSTGRES_PASSWORD'):
        raise RuntimeError('Falta configuración en los contenedores. No se generan nuevas contraseñas.')
    if db_env.get('POSTGRES_USER') != 'tallerflow' or db_env.get('POSTGRES_DB') != 'tallerflow':
        raise RuntimeError('La base actual no coincide con el perfil del taller.')

    releases = root / '.releases'
    releases.mkdir(exist_ok=True)
    release = Path(tempfile.mkdtemp(prefix=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-'), dir=releases))
    source = release / 'source'
    run(['git', 'init', '-q', str(source)])
    run(['git', '-C', str(source), 'remote', 'add', 'origin', options.repository])
    run(['git', '-C', str(source), 'fetch', '--depth', '1', 'origin', options.ref])
    run(['git', '-C', str(source), 'checkout', '-q', '--detach', 'FETCH_HEAD'])
    sha = run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture=True)
    if not (source / 'compose.yaml').is_file():
        raise RuntimeError('La versión descargada no contiene compose.yaml.')

    env = {**os.environ, 'COMPOSE_PROJECT_NAME': project, 'APP_VERSION': sha[:12],
           'HTTP_PORT': host_port, 'BIND_IP': host_ip, 'POSTGRES_PASSWORD': db_env['POSTGRES_PASSWORD'],
           'ADMIN_EMAIL': api_env['ADMIN_EMAIL'], 'ADMIN_PASSWORD': api_env['ADMIN_PASSWORD'],
           'COOKIE_SECURE': api_env.get('COOKIE_SECURE', 'false'), 'SEED_DEMO': 'false'}
    config = json.loads(run(['docker', 'compose', '-p', project, '-f', str(source / 'compose.yaml'),
                            'config', '--format', 'json'], capture=True, env=env))
    # Preservar la configuración de la aplicación y la conexión real a la BD.
    kept_env = {k: v for k, v in api_env.items() if k not in ['PATH', 'HOSTNAME', 'NODE_VERSION', 'YARN_VERSION']}
    config['services']['api']['environment'].update(kept_env)
    config['services']['api']['environment']['SEED_DEMO'] = 'false'
    config['services']['db']['environment'].update({k: v for k, v in db_env.items() if k.startswith('POSTGRES_')})
    config['volumes'] = {key: {'external': True, 'name': name} for key, name in volume_names.items()}
    config['networks'] = {'backend': {'external': True, 'name': network}}
    config_file = release / 'compose.production.json'
    write_json(config_file, config)
    compose = ['docker', 'compose', '-p', project, '-f', str(config_file)]
    run(compose + ['config', '--quiet'])
    # Compilar antes de la ventana de sustitución. Aún no se tocan los servicios.
    run(compose + ['build', 'api', 'web'])

    backup = root / 'backups' / release.name
    backup.mkdir(parents=True)
    write_json(backup / 'containers.json', containers)
    with (backup / 'database.dump.partial').open('wb') as output:
        run(['docker', 'exec', containers['db']['Id'], 'pg_dump', '-U', 'tallerflow', '-d', 'tallerflow', '-Fc'], output=output)
    with (backup / 'uploads.tgz.partial').open('wb') as output:
        run(['docker', 'exec', containers['api']['Id'], 'tar', '-czf', '-', '-C', '/data/uploads', '.'], output=output)
    if not (backup / 'database.dump.partial').stat().st_size:
        raise RuntimeError('El respaldo de PostgreSQL está vacío. No se actualiza.')
    with (backup / 'database.dump.partial').open('rb') as dump:
        subprocess.run(['docker', 'exec', '-i', containers['db']['Id'], 'pg_restore', '--list'],
                       stdin=dump, stdout=subprocess.DEVNULL, check=True)
    with gzip.open(backup / 'uploads.tgz.partial', 'rb') as archive:
        while archive.read(1024 * 1024):
            pass
    (backup / 'database.dump.partial').rename(backup / 'database.dump')
    (backup / 'uploads.tgz.partial').rename(backup / 'uploads.tgz')

    rollback = json.loads(json.dumps(config))
    for service in ['api', 'web']:
        rollback['services'][service].pop('build', None)
        rollback['services'][service]['image'] = containers[service]['Image']
        rollback['services'][service]['environment'] = environment(containers[service])
    rollback_file = backup / 'compose.rollback.json'
    write_json(rollback_file, rollback)
    try:
        run(compose + ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '150', 'api', 'web'])
        for attempt in range(30):
            try:
                run(['docker', 'exec', f'{project}-web-1', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/api/health'], capture=True)
                break
            except subprocess.CalledProcessError:
                if attempt == 29:
                    raise
                time.sleep(1)
        run(['docker', 'exec', f'{project}-web-1', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/seguimiento'])
    except Exception:
        print('La nueva versión falló. Recuperando las imágenes anteriores; se conserva la base.', flush=True)
        run(['docker', 'compose', '-p', project, '-f', str(rollback_file), 'up', '-d', '--no-deps', '--no-build',
             '--wait', '--wait-timeout', '150', 'api', 'web'])
        raise
    write_json(root / 'production-release.json', {'commit': sha, 'compose': str(config_file), 'backup': str(backup), 'port': host_port})
    run(compose + ['ps'])
    print(f'Actualización completada: {sha}\nRespaldo: {backup}\nPuerto HTTP conservado: {host_port}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default='/docker/kanban-motoresmorichal')
    parser.add_argument('--project', default='kanban-motoresmorichal')
    parser.add_argument('--repository', default='https://github.com/merchandev/kanban-motoresmorichal.git')
    parser.add_argument('--ref', default='main')
    try:
        update(parser.parse_args())
    except subprocess.CalledProcessError as error:
        # No imprimir args, variables ni config resuelta: pueden contener secretos.
        print(f'ERROR: un comando terminó con código {error.returncode}. Se conservaron respaldos y volúmenes.')
        raise SystemExit(1)
    except Exception as error:
        print('ERROR:', str(error))
        raise SystemExit(1)
