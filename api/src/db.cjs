const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL, max:12, idleTimeoutMillis:30000, connectionTimeoutMillis:15000});
const q=(sql,params=[])=>pool.query(sql,params);
async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(err){await c.query('ROLLBACK');throw err}finally{c.release()}}
module.exports={pool,q,tx};
