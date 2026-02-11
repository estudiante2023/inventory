// servicios/usuarios-online.service.ts
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

@Injectable({
  providedIn: 'root'
})
export class UsuariosOnlineService {

  constructor() {}

  // Agregar usuario cuando inicia sesión
  async agregarUsuarioOnline(usuarioId: string) {
    try {
      
      const { error } = await supabase
        .from('usuarios_online')
        .upsert({
          usuario_id: usuarioId,
          ultima_actividad: new Date().toISOString()
        }, {
          onConflict: 'usuario_id'
        });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error agregando usuario online:', error);
      return false;
    }
  }

  // Quitar usuario cuando cierra sesión
  async quitarUsuarioOnline(usuarioId: string) {
    try {
      
      const { error } = await supabase
        .from('usuarios_online')
        .delete()
        .eq('usuario_id', usuarioId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error quitando usuario online:', error);
      return false;
    }
  }

  // Obtener todos los usuarios en línea usando la función de PostgreSQL
  async obtenerUsuariosOnline() {
    try {
      // Llamar a la función de PostgreSQL que creamos
      const { data, error } = await supabase
        .rpc('get_usuarios_online');

      if (error) {
        console.error('Error al llamar a get_usuarios_online:', error);
        throw error;
      }
      
      return data || [];
      
    } catch (error) {
      console.error('Error obteniendo usuarios online:', error);
      return [];
    }
  }

  async obtenerMensajeUsuariosEnLinea(): Promise<string> {
  try {
    // Obtener usuarios en línea
    const usuarios = await this.obtenerUsuariosOnline();
    
    if (!usuarios || usuarios.length === 0) {
      return "No hay usuarios en línea";
    }
    
    const totalUsuarios = usuarios.length;
    
    if (totalUsuarios === 1) {
      // Verificar si el único usuario en línea es el usuario actual
      const { data: usuarioActual } = await supabase.auth.getUser();
      const usuarioActualId = usuarioActual?.user?.id;
      
      // Buscar si el usuario actual está en la lista
      const esUsuarioActual = usuarios.some((u: any) => u.usuario_id === usuarioActualId);
      
      if (esUsuarioActual) {
        // Solo está el usuario actual
        return "Solo tú en línea";
      } else {
        // Hay otro usuario en línea
        const primerUsuario = usuarios[0];
        return `${primerUsuario.nombre_completo || '1 usuario'} en línea`;
      }
    }
    
    // Si hay más de 1 usuario
    return `${totalUsuarios} usuarios en línea`;
    
  } catch (error) {
    console.error('Error obteniendo mensaje usuarios en línea:', error);
    return "No disponible";
  }
}
 
  async limpiarInactivos() {
    try {
      const treintaMinutosAtras = new Date();
      treintaMinutosAtras.setMinutes(treintaMinutosAtras.getMinutes() - 30);
      
      const { error } = await supabase
        .from('usuarios_online')
        .delete()
        .lt('ultima_actividad', treintaMinutosAtras.toISOString());

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error limpiando inactivos:', error);
      return false;
    }
  }
}