import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsuariosService, Usuario, UpdateUsuarioData } from '../../services/usuarios.service';
import { RolesService, Rol } from '../../services/roles.service';

@Component({
  selector: 'app-usuarios',
  imports: [CommonModule, FormsModule],
  templateUrl: './usuarios.html',
  styleUrls: ['./usuarios.css']
})
export class Usuarios implements OnInit {
  @ViewChild('dialogUsuario') dialogUsuario!: ElementRef;
  @ViewChild('dialogConfirm') dialogConfirm!: ElementRef;

  // Lista de usuarios
  usuarios: Usuario[] = [];
  loading = true;
  
  // Filtros y paginación
  filters = {
    search: '',
    estado: 'todos',
    role_id: 0,
    page: 1,
    limit: 10
  };
  totalUsuarios = 0;
  totalPages = 0;
  
  // Roles disponibles
  roles: Rol[] = [];
  
  // Usuario seleccionado para editar
  usuarioSeleccionado: Usuario | null = null;
  modoEdicion = false;
  
  // Formulario
  usuarioForm: any = {
    nombre_completo: '',
    role_id: null,
    telefono: '',
    avatar_url: '',
    estado: 'activo'
  };
  submitted = false;
  
  // Usuario para eliminar
  usuarioAEliminar: Usuario | null = null;
  eliminando = false;
  
  // Notificaciones
  notificacion = {
    show: false,
    mensaje: '',
    tipo: 'success' // success, error, warning
  };

  constructor(
    private usuariosService: UsuariosService,
    private rolesService: RolesService
  ) {
    console.log('✅ UsuariosComponent inicializado');
  }

  async ngOnInit() {
    await this.cargarRoles();
    await this.cargarUsuarios();
  }

  // ==================== CARGA DE DATOS ====================

  async cargarUsuarios() {
    this.loading = true;
    try {
      const result = await this.usuariosService.getUsuarios(this.filters);
      this.usuarios = result.data;
      this.totalUsuarios = result.count;
      this.totalPages = Math.ceil(this.totalUsuarios / this.filters.limit);
      
      console.log(`✅ ${this.usuarios.length} usuarios cargados`);
    } catch (error: any) {
      console.error('❌ Error cargando usuarios:', error);
      this.mostrarNotificacion(error.message, 'error');
    } finally {
      this.loading = false;
    }
  }

  async cargarRoles() {
    try {
      const result = await this.rolesService.getRoles({ esta_activo: true });
      this.roles = result.data;
      console.log(`✅ ${this.roles.length} roles cargados`);
    } catch (error) {
      console.error('❌ Error cargando roles:', error);
    }
  }

  // ==================== MÉTODOS DE TABLA ====================

  async cambiarPagina(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.filters.page = page;
    await this.cargarUsuarios();
  }

  get paginasMostradas(): number[] {
    const pages: number[] = [];
    const totalPages = this.totalPages;
    const currentPage = this.filters.page;
    
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, 5);
      } else if (currentPage >= totalPages - 2) {
        pages.push(totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2);
      }
    }
    
    return pages;
  }

  // ==================== CRUD USUARIOS ====================

  abrirModalEditar(usuario: Usuario) {
    this.modoEdicion = true;
    this.usuarioSeleccionado = usuario;
    this.usuarioForm = {
      nombre_completo: usuario.nombre_completo || '',
      role_id: usuario.role_id,
      telefono: usuario.telefono || '',
      avatar_url: usuario.avatar_url || '',
      estado: usuario.estado || 'activo'
    };
    this.submitted = false;
    this.mostrarModal('usuario');
  }

  async guardarUsuario() {
    this.submitted = true;
    
    // Validaciones básicas
    if (!this.usuarioForm.nombre_completo?.trim()) {
      this.mostrarNotificacion('El nombre completo es obligatorio', 'error');
      return;
    }

    try {
      if (this.modoEdicion && this.usuarioSeleccionado) {
        // Actualizar usuario
        await this.usuariosService.updateUsuario(
          this.usuarioSeleccionado.id, 
          this.usuarioForm
        );
        this.mostrarNotificacion('Usuario actualizado correctamente', 'success');
      } else {
        // Crear usuario - ya no lo manejamos aquí
        this.mostrarNotificacion('Use el sistema de registro para crear usuarios', 'warning');
        return;
      }
      
      this.cerrarModal('usuario');
      await this.cargarUsuarios();
      
    } catch (error: any) {
      console.error('❌ Error guardando usuario:', error);
      this.mostrarNotificacion(error.message, 'error');
    }
  }

  async cambiarEstadoUsuario(usuario: Usuario) {
    const confirmar = confirm(`¿Estás seguro de ${usuario.estado === 'activo' ? 'desactivar' : 'activar'} a ${usuario.nombre_completo || usuario.email}?`);
    
    if (!confirmar) return;
    
    try {
      if (usuario.estado === 'activo') {
        await this.usuariosService.desactivarUsuario(usuario.id);
        this.mostrarNotificacion('Usuario desactivado correctamente', 'success');
      } else {
        await this.usuariosService.activarUsuario(usuario.id);
        this.mostrarNotificacion('Usuario activado correctamente', 'success');
      }
      
      await this.cargarUsuarios();
      
    } catch (error: any) {
      console.error('❌ Error cambiando estado:', error);
      this.mostrarNotificacion(error.message, 'error');
    }
  }

  async cambiarRolUsuario(usuario: Usuario, event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const role_id = selectElement.value ? +selectElement.value : null;
    try {
      await this.usuariosService.cambiarRolUsuario(usuario.id, role_id);
      this.mostrarNotificacion('Rol actualizado correctamente', 'success');
      await this.cargarUsuarios();
    } catch (error: any) {
      console.error('❌ Error cambiando rol:', error);
      this.mostrarNotificacion(error.message, 'error');
    }
  }

  abrirModalEliminar(usuario: Usuario) {
    this.usuarioAEliminar = usuario;
    this.mostrarModal('confirm');
  }

  async eliminarUsuarioConfirmado() {
    if (!this.usuarioAEliminar) return;
    
    this.eliminando = true;
    try {
      await this.usuariosService.eliminarUsuario(this.usuarioAEliminar.id);
      this.mostrarNotificacion('Usuario eliminado correctamente', 'success');
      this.cerrarModal('confirm');
      await this.cargarUsuarios();
    } catch (error: any) {
      console.error('❌ Error eliminando usuario:', error);
      this.mostrarNotificacion(error.message, 'error');
    } finally {
      this.eliminando = false;
      this.usuarioAEliminar = null;
    }
  }

  // ==================== UTILIDADES ====================

  getRolNombre(role_id: number | null): string {
    if (!role_id) return 'Sin rol';
    const rol = this.roles.find(r => r.id === role_id);
    return rol ? rol.nombre : 'Rol desconocido';
  }

  getBadgeClass(estado: string): string {
    switch (estado) {
      case 'activo': return 'badge-activo';
      case 'inactivo': return 'badge-inactivo';
      case 'pendiente': return 'badge-pendiente';
      default: return 'badge-default';
    }
  }

  getEstadoTexto(estado: string): string {
    switch (estado) {
      case 'activo': return 'Activo';
      case 'inactivo': return 'Inactivo';
      case 'pendiente': return 'Pendiente';
      default: return estado;
    }
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // ==================== MODALES Y NOTIFICACIONES ====================

  mostrarModal(tipo: 'usuario' | 'confirm') {
    if (tipo === 'usuario' && this.dialogUsuario?.nativeElement) {
      this.dialogUsuario.nativeElement.classList.add('show');
    } else if (tipo === 'confirm' && this.dialogConfirm?.nativeElement) {
      this.dialogConfirm.nativeElement.classList.add('show');
    }
  }

  cerrarModal(tipo: 'usuario' | 'confirm') {
    if (tipo === 'usuario' && this.dialogUsuario?.nativeElement) {
      this.dialogUsuario.nativeElement.classList.remove('show');
      this.usuarioSeleccionado = null;
      this.submitted = false;
    } else if (tipo === 'confirm' && this.dialogConfirm?.nativeElement) {
      this.dialogConfirm.nativeElement.classList.remove('show');
      this.usuarioAEliminar = null;
    }
  }

  mostrarNotificacion(mensaje: string, tipo: 'success' | 'error' | 'warning') {
    this.notificacion = {
      show: true,
      mensaje,
      tipo
    };

    setTimeout(() => {
      this.notificacion.show = false;
    }, 5000);
  }
}