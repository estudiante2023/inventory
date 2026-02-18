import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';  

export interface Usuario {
  id?: string;          // UUID (referencia a auth.users)
  cedula: string;
  nombre: string;
  apellido?: string;
  telefono?: string;
  direccion?: string;
  rol: 'cliente' | 'admin' | 'vendedor';
  activo: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SbUsuariosService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
  }

  /**
   * Obtiene todos los usuarios, con filtros opcionales.
   * @param filtros Objeto con campos para filtrar: cedula, nombre, apellido, rol, activo, etc.
   */
  async getAll(filtros?: {
    cedula?: string;
    nombre?: string;
    apellido?: string;
    rol?: string;
    activo?: boolean;
  }): Promise<Usuario[]> {
    let query = this.supabase.from('usuarios').select('*');

    if (filtros) {
      if (filtros.cedula) query = query.ilike('cedula', `%${filtros.cedula}%`);
      if (filtros.nombre) query = query.ilike('nombre', `%${filtros.nombre}%`);
      if (filtros.apellido) query = query.ilike('apellido', `%${filtros.apellido}%`);
      if (filtros.rol) query = query.eq('rol', filtros.rol);
      if (filtros.activo !== undefined) query = query.eq('activo', filtros.activo);
    }

    const { data, error } = await query.order('nombre', { ascending: true });

    if (error) {
      console.error('Error al obtener usuarios:', error);
      return [];
    }
    return data || [];
  }

  /**
   * Obtiene un usuario por su ID (UUID).
   */
  async getById(id: string): Promise<Usuario | null> {
    const { data, error } = await this.supabase
      .from('usuarios')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(`Error al obtener usuario con ID ${id}:`, error);
      return null;
    }
    return data;
  }

  /**
   * Obtiene un usuario por cédula.
   */
  async getByCedula(cedula: string): Promise<Usuario | null> {
    const { data, error } = await this.supabase
      .from('usuarios')
      .select('*')
      .eq('cedula', cedula)
      .maybeSingle();

    if (error) {
      console.error(`Error al obtener usuario con cédula ${cedula}:`, error);
      return null;
    }
    return data;
  }

  /**
   * Crea un nuevo usuario.
   * Nota: El id debe coincidir con un usuario en auth.users (se puede obtener al registrar desde Supabase Auth).
   */
  async create(usuario: Usuario): Promise<Usuario> {
    const { data, error } = await this.supabase
      .from('usuarios')
      .insert([usuario])
      .select()
      .single();

    if (error) {
      console.error('Error al crear usuario:', error);
      throw error;
    }
    return data;
  }

  /**
   * Actualiza un usuario existente.
   */
  async update(id: string, usuario: Partial<Usuario>): Promise<Usuario> {
    const { data, error } = await this.supabase
      .from('usuarios')
      .update(usuario)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`Error al actualizar usuario con ID ${id}:`, error);
      throw error;
    }
    return data;
  }

  /**
   * Elimina un usuario (soft delete o hard delete según políticas).
   * Aquí se puede implementar borrado lógico si se prefiere.
   */
  async delete(id: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('usuarios')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`Error al eliminar usuario con ID ${id}:`, error);
      throw error;
    }
    return true;
  }

  /**
   * Alterna el estado activo/inactivo de un usuario.
   */
  async toggleActivo(id: string): Promise<boolean> {
    const usuario = await this.getById(id);
    if (!usuario) throw new Error('Usuario no encontrado');
    const nuevoEstado = !usuario.activo;
    await this.update(id, { activo: nuevoEstado });
    return nuevoEstado;
  }

  /**
   * Obtiene usuarios por rol.
   */
  async getByRol(rol: string, activo?: boolean): Promise<Usuario[]> {
    let query = this.supabase.from('usuarios').select('*').eq('rol', rol);
    if (activo !== undefined) query = query.eq('activo', activo);
    const { data, error } = await query.order('nombre', { ascending: true });
    if (error) {
      console.error(`Error al obtener usuarios con rol ${rol}:`, error);
      return [];
    }
    return data || [];
  }
}