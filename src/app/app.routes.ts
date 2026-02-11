import { Routes } from '@angular/router';
import { Inicio } from './inicio/inicio';
import { Navegacion } from './navegacion/navegacion';
import { Inventario } from './inventario/inventario';  
import { Estadisticas } from './estadisticas/estadisticas';
import { Loguin } from './loguin/loguin';
import { Trazabilidad } from './trazabilidad/trazabilidad';
import { Ubicacion } from './ubicacion/ubicacion';
import { Usuarios } from './usuarios/usuarios';
import { Roles } from './roles/roles';
import { Configuracion } from './configuracion/configuracion';
import { Correo } from './correo/correo';
import { Registro } from './registro/registro';
import { AuthGuard } from '../services/auth.guard';  
import { LoginGuard } from '../services/login.guard';

export const routes: Routes = [
  // Rutas públicas (sin protección)
   { 
    path: 'login', 
    component: Loguin,
    canActivate: [LoginGuard] // ← Esto bloquea acceso si ya estás logueado
  },
  { 
    path: 'registro', 
    component: Registro,
    canActivate: [LoginGuard] // ← Esto también
  },
  
  // Rutas protegidas (requieren autenticación)
  { 
    path: 'navegacion', 
    component: Navegacion,
    canActivate: [AuthGuard]
  },
  { 
    path: 'inventario', 
    component: Inventario,
    canActivate: [AuthGuard]
  },
  { 
    path: 'configuracion', 
    component: Configuracion,
    canActivate: [AuthGuard]
  },
  { 
    path: 'estadistica', 
    component: Estadisticas,
    canActivate: [AuthGuard]
  },
  { 
    path: 'trazabilidad', 
    component: Trazabilidad,
    canActivate: [AuthGuard]
  },
  { 
    path: 'ubicacion', 
    component: Ubicacion,
    canActivate: [AuthGuard]
  },
  { 
    path: 'usuario', 
    component: Usuarios,
    canActivate: [AuthGuard]
  },
  { 
    path: 'rol', 
    component: Roles,
    canActivate: [AuthGuard]
  },
  { 
    path: 'correo', 
    component: Correo,
    canActivate: [AuthGuard]
  },
  { 
    path: 'inicio', 
    component: Inicio,
    canActivate: [AuthGuard]
  },
  
  // Redirecciones
  { path: '', redirectTo: '/login', pathMatch: 'full' }, // Redirige root a login
  { path: '**', redirectTo: '/login' } // Ruta para manejar errores
];