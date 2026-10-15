import React from 'react';import {createRoot} from 'react-dom/client';import App from './App.jsx';import Registro from './Registro.jsx';import {printCredits} from './credits.js';
import '@fontsource-variable/inter/opsz.css';import '@fontsource-variable/jetbrains-mono';
import './styles.css';
printCredits();
// /registro es el formulario público del QR (sin inicio de sesión); el resto es la aplicación del taller.
const Page=location.pathname.replace(/\/+$/,'')==='/registro'?Registro:App;
createRoot(document.getElementById('root')).render(<React.StrictMode><Page/></React.StrictMode>);
