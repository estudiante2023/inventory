import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RolesService, Rol, Privilegio, RolConPrivilegios } from '../../services/roles.service';
import { TrazabilidadService } from '../../services/trazabilidad.service';

@Component({
  selector: 'app-roles',
  templateUrl: './roles.html',
  styleUrls: ['./roles.css'],
  imports: [CommonModule, FormsModule, ReactiveFormsModule]
})
export class Roles implements OnInit {
  @ViewChild('dialogRol') dialogRol!: ElementRef;
  @ViewChild('dialogPrivilegios') dialogPrivilegios!: ElementRef;
  @ViewChild('confirmModal') confirmModal!: ElementRef;
  
  // Datos principales
  roles: Rol[] = [];
  rolesConConteo: (Rol & { total_privilegios: number })[] = [];
  
  // Datos para asignación de privilegios
  privilegiosDisponibles: Privilegio[] = [];
  privilegiosAgrupados: Record<string, Privilegio[]> = {};
  rolSeleccionado: RolConPrivilegios | null = null;
  
  // Estados
  cargando = false;
  cargandoPrivilegios = false;
  modoEdicion = false;
  mostrarDialogoRol = false;
  mostrarDialogoPrivilegios = false;
  totalRegistros = 0;
  paginaActual = 1;
  itemsPorPagina = 10;
  totalPaginas = 0;
  
  // Búsqueda y filtros
  terminoBusqueda = '';
  filtroEstado = 'todos';
  
  // Formulario de rol
  rolForm: FormGroup;
  submitted = false;
  nombreExistente = false;
  
  // Gestión de privilegios (checkboxes)
  privilegiosSeleccionados: Set<number> = new Set();
  userPrivileges: string[] = [];
  // Confirmación
  accionConfirmacion: 'eliminar' | 'desactivar' | 'activar' = 'eliminar';
  mensajeConfirmacion = '';
  idConfirmacion: number | null = null;
  nombreConfirmacion = '';
  
  // Variables para estadísticas
  modulosDisponibles: string[] = [];
  esAdmin: boolean = false;
  constructor(
    private rolesService: RolesService,
    private fb: FormBuilder,
    private trazabilidadService: TrazabilidadService
  ) {
    // Inicializar formulario para roles
    this.rolForm = this.fb.group({
      nombre: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      descripcion: ['', Validators.maxLength(200)],
      nivel_permisos: [0, [Validators.required, Validators.min(0), Validators.max(1000)]],
      esta_activo: [true]
    });
  }
  
  async ngOnInit() {
    await this.cargarDatosIniciales();
    this.loadUserPrivileges();
  }
  private loadUserPrivileges() {
    try {
      const privilegiosGuardados = localStorage.getItem('user_privileges');
      if (privilegiosGuardados) {
        this.userPrivileges = JSON.parse(privilegiosGuardados);
        console.log('✅ Privilegios cargados en Inventario:', this.userPrivileges);
      }
    } catch (error) {
      console.error('❌ Error cargando privilegios:', error);
      this.userPrivileges = [];
    }
  }
  async verificarPermisos() {
    // Verificar si el usuario es administrador
    this.esAdmin = await this.trazabilidadService.validarPermisosAdmin();
  }
tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }
  // Cargar todos los datos necesarios
  async cargarDatosIniciales() {
    await Promise.all([
      this.cargarRoles(),
      this.cargarPrivilegiosYModulos()
    ]);
  }
  
  // Cargar lista de roles con paginación
  async cargarRoles() {
    try {
      this.cargando = true;
      
      const filters: any = {
        search: this.terminoBusqueda,
        page: this.paginaActual,
        limit: this.itemsPorPagina,
        ordenar_por: 'created_at',
        orden: 'desc'
      };
      
      // Aplicar filtro de estado
      if (this.filtroEstado === 'activos') {
        filters.esta_activo = true;
      } else if (this.filtroEstado === 'inactivos') {
        filters.esta_activo = false;
      }
      
      const resultado = await this.rolesService.getRoles(filters);
      
      this.roles = resultado.data;
      this.totalRegistros = resultado.count;
      this.totalPaginas = Math.ceil(this.totalRegistros / this.itemsPorPagina);
      
      // También cargar roles con conteo de privilegios
      this.rolesConConteo = await this.rolesService.getRolesConConteo();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error al cargar roles: ${error.message}`);
    } finally {
      this.cargando = false;
    }
  }
  
  // Cargar privilegios disponibles y módulos
  async cargarPrivilegiosYModulos() {
    try {
      // Obtener todos los privilegios (solo lectura)
      this.privilegiosDisponibles = await this.rolesService.getPrivilegios();
      
      // Agrupar privilegios por módulo para mostrar organizados
      this.privilegiosAgrupados = await this.rolesService.getPrivilegiosAgrupados();
      
      // Obtener módulos únicos
      this.modulosDisponibles = await this.rolesService.getModulos();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error al cargar privilegios: ${error.message}`);
    }
  }
  
  // Filtrar roles según búsqueda y filtros
  get rolesFiltrados() {
    return this.rolesConConteo;
  }
  
  // Verificar si un nombre de rol ya existe
  async verificarNombreExistente() {
    const nombre = this.rolForm.get('nombre')?.value;
    if (!nombre) return;
    
    if (this.modoEdicion && this.rolSeleccionado) {
      this.nombreExistente = await this.rolesService.checkNombreExists(
        nombre, 
        this.rolSeleccionado.id
      );
    } else {
      this.nombreExistente = await this.rolesService.checkNombreExists(nombre);
    }
  }
  
  // ==================== MÉTODOS PARA ROLES ====================
  
  abrirCrearRol() {
    this.modoEdicion = false;
    this.submitted = false;
    this.nombreExistente = false;
    this.rolSeleccionado = null;
    
    this.rolForm.reset({
      nombre: '',
      descripcion: '',
      nivel_permisos: 0,
      esta_activo: true
    });
    
    this.mostrarModal(this.dialogRol);
  }
  
  async abrirEditarRol(rol: Rol) {
    try {
      this.cargando = true;
      this.modoEdicion = true;
      this.submitted = false;
      this.nombreExistente = false;
      this.rolSeleccionado = null;
      
      // Cargar datos del rol
      const rolConPrivilegios = await this.rolesService.getRolConPrivilegios(rol.id);
      this.rolSeleccionado = rolConPrivilegios;
      
      this.rolForm.patchValue({
        nombre: rol.nombre,
        descripcion: rol.descripcion || '',
        nivel_permisos: rol.nivel_permisos,
        esta_activo: rol.esta_activo
      });
      
      this.mostrarModal(this.dialogRol);
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error al cargar rol: ${error.message}`);
    } finally {
      this.cargando = false;
    }
  }
  
  async guardarRol() {
    this.submitted = true;
    
    if (this.rolForm.invalid) {
      this.mostrarNotificacion('warning', 'Por favor complete los campos requeridos correctamente');
      return;
    }
    
    if (this.nombreExistente) {
      this.mostrarNotificacion('error', 'Ya existe un rol con ese nombre');
      return;
    }
    
    try {
      const formValue = this.rolForm.value;
      
      if (this.modoEdicion && this.rolSeleccionado) {
        // Actualizar rol existente
        await this.rolesService.updateRol(this.rolSeleccionado.id, formValue);
        this.mostrarNotificacion('success', 'Rol actualizado correctamente');
      } else {
        // Crear nuevo rol
        await this.rolesService.createRol(formValue);
        this.mostrarNotificacion('success', 'Rol creado correctamente');
      }
      
      this.cerrarModal('rol');
      await this.cargarRoles();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    }
  }
  
  // ==================== MÉTODOS PARA PRIVILEGIOS ====================
  
  async abrirGestionarPrivilegios(rol: Rol) {
    try {
      this.cargandoPrivilegios = true;
      
      // Cargar rol con sus privilegios actuales
      this.rolSeleccionado = await this.rolesService.getRolConPrivilegios(rol.id);
      
      // Inicializar set de privilegios seleccionados
      this.privilegiosSeleccionados = new Set(
        this.rolSeleccionado.privilegios.map(p => p.id)
      );
      
      this.mostrarModal(this.dialogPrivilegios);
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error al cargar privilegios: ${error.message}`);
    } finally {
      this.cargandoPrivilegios = false;
    }
  }
  
  togglePrivilegio(privilegioId: number) {
    if (this.privilegiosSeleccionados.has(privilegioId)) {
      this.privilegiosSeleccionados.delete(privilegioId);
    } else {
      this.privilegiosSeleccionados.add(privilegioId);
    }
  }
  
  async guardarPrivilegios() {
    if (!this.rolSeleccionado) return;
    
    try {
      const privilegioIds = Array.from(this.privilegiosSeleccionados);
      
      // Sincronizar privilegios (reemplaza todos los existentes)
      await this.rolesService.sincronizarPrivilegiosDelRol(
        this.rolSeleccionado.id, 
        privilegioIds
      );
      
      this.mostrarNotificacion('success', 'Privilegios asignados correctamente');
      this.cerrarModal('privilegios');
      await this.cargarRoles(); // Recargar para actualizar conteos
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    }
  }
  
  seleccionarTodosPrivilegios(modulo?: string) {
    if (modulo) {
      // Seleccionar todos los privilegios de un módulo específico
      const privilegiosDelModulo = this.privilegiosAgrupados[modulo] || [];
      privilegiosDelModulo.forEach(p => this.privilegiosSeleccionados.add(p.id));
    } else {
      // Seleccionar todos los privilegios
      this.privilegiosDisponibles.forEach(p => this.privilegiosSeleccionados.add(p.id));
    }
  }
  
  deseleccionarTodosPrivilegios(modulo?: string) {
    if (modulo) {
      // Deseleccionar todos los privilegios de un módulo específico
      const privilegiosDelModulo = this.privilegiosAgrupados[modulo] || [];
      privilegiosDelModulo.forEach(p => this.privilegiosSeleccionados.delete(p.id));
    } else {
      // Deseleccionar todos los privilegios
      this.privilegiosDisponibles.forEach(p => this.privilegiosSeleccionados.delete(p.id));
    }
  }
  
  // Verificar si un módulo está completamente seleccionado
  moduloCompletamenteSeleccionado(modulo: string): boolean {
    const privilegiosDelModulo = this.privilegiosAgrupados[modulo] || [];
    if (privilegiosDelModulo.length === 0) return false;
    
    return privilegiosDelModulo.every(p => 
      this.privilegiosSeleccionados.has(p.id)
    );
  }
  
  // Verificar si un módulo está parcialmente seleccionado
  moduloParcialmenteSeleccionado(modulo: string): boolean {
    const privilegiosDelModulo = this.privilegiosAgrupados[modulo] || [];
    if (privilegiosDelModulo.length === 0) return false;
    
    const seleccionados = privilegiosDelModulo.filter(p => 
      this.privilegiosSeleccionados.has(p.id)
    ).length;
    
    return seleccionados > 0 && seleccionados < privilegiosDelModulo.length;
  }
  
  // ==================== MÉTODOS DE CONFIRMACIÓN ====================
  
  confirmarAccion(accion: 'eliminar' | 'desactivar' | 'activar', rol: Rol) {
    this.accionConfirmacion = accion;
    this.idConfirmacion = rol.id;
    this.nombreConfirmacion = rol.nombre;
    
    switch (accion) {
      case 'eliminar':
        this.mensajeConfirmacion = `¿Está seguro de eliminar el rol "${rol.nombre}"?`;
        break;
      case 'desactivar':
        this.mensajeConfirmacion = `¿Está seguro de desactivar el rol "${rol.nombre}"?`;
        break;
      case 'activar':
        this.mensajeConfirmacion = `¿Está seguro de activar el rol "${rol.nombre}"?`;
        break;
    }
    
    this.mostrarModal(this.confirmModal);
  }
  
  async ejecutarConfirmacion() {
    if (!this.idConfirmacion) return;
    
    try {
      switch (this.accionConfirmacion) {
        case 'eliminar':
          await this.rolesService.eliminarRol(this.idConfirmacion);
          this.mostrarNotificacion('success', 'Rol eliminado correctamente');
          break;
        case 'desactivar':
          await this.rolesService.desactivarRol(this.idConfirmacion);
          this.mostrarNotificacion('success', 'Rol desactivado correctamente');
          break;
        case 'activar':
          await this.rolesService.activarRol(this.idConfirmacion);
          this.mostrarNotificacion('success', 'Rol activado correctamente');
          break;
      }
      
      this.cerrarConfirmacion();
      await this.cargarRoles();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    }
  }
  
  // ==================== MÉTODOS DE UTILIDAD ====================
  
  cambiarPagina(pagina: number) {
    if (pagina < 1 || pagina > this.totalPaginas) return;
    
    this.paginaActual = pagina;
    this.cargarRoles();
  }
  
  buscarRoles() {
    this.paginaActual = 1;
    this.cargarRoles();
  }
  
  limpiarBusqueda() {
    this.terminoBusqueda = '';
    this.filtroEstado = 'todos';
    this.paginaActual = 1;
    this.cargarRoles();
  }
  
  get paginasNumeros() {
    const paginas = [];
    const inicio = Math.max(1, this.paginaActual - 2);
    const fin = Math.min(this.totalPaginas, inicio + 4);
    
    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }
    return paginas;
  }
  
  // ==================== HELPERS PARA LA VISTA ====================
  
  getBadgeEstado(esta_activo: boolean): { clase: string, texto: string } {
    return esta_activo ? 
      { clase: 'badge-activo', texto: 'Activo' } : 
      { clase: 'badge-inactivo', texto: 'Inactivo' };
  }
  
  getBadgeNivel(nivel: number): { clase: string, texto: string } {
    if (nivel >= 100) {
      return { clase: 'badge-admin', texto: 'Administrador' };
    } else if (nivel >= 50) {
      return { clase: 'badge-moderador', texto: 'Moderador' };
    } else if (nivel >= 20) {
      return { clase: 'badge-usuario', texto: 'Usuario Avanzado' };
    } else {
      return { clase: 'badge-basico', texto: 'Usuario Básico' };
    }
  }
  
  // ==================== MANEJO DE MODALES ====================
  
  private mostrarModal(modal: ElementRef) {
    const elemento = modal.nativeElement;
    elemento.style.display = 'block';
    setTimeout(() => elemento.classList.add('show'), 10);
  }
  
  cerrarModal(modalType: 'rol' | 'privilegios') {
    if (modalType === 'rol') {
      this.cerrarModalElemento(this.dialogRol);
    } else {
      this.cerrarModalElemento(this.dialogPrivilegios);
    }
  }
  
  cerrarConfirmacion() {
    this.cerrarModalElemento(this.confirmModal);
  }
  
  private cerrarModalElemento(modal: ElementRef) {
    const elemento = modal.nativeElement;
    elemento.classList.remove('show');
    setTimeout(() => {
      elemento.style.display = 'none';
    }, 300);
  }
  
  // ==================== NOTIFICACIONES ====================
  
  mostrarNotificacion(tipo: 'success' | 'error' | 'warning', mensaje: string) {
    const notificacion = document.createElement('div');
    notificacion.className = `notificacion ${tipo}`;
    notificacion.textContent = mensaje;
    
    document.body.appendChild(notificacion);
    
    setTimeout(() => {
      notificacion.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      notificacion.classList.remove('show');
      setTimeout(() => {
        document.body.removeChild(notificacion);
      }, 300);
    }, 3000);
  }
  
  // ==================== GETTERS PARA FORMULARIOS ====================
  
  get f() { return this.rolForm.controls; }
}