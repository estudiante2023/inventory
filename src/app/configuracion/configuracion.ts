// src/app/components/configuracion/configuracion.component.ts
import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ConfiguracionesService, Configuracionx } from '../../services/configuraciones.service';
import { TrazabilidadService } from '../../services/trazabilidad.service';

@Component({
  selector: 'app-configuracion',
  templateUrl: './configuracion.html',
  styleUrls: ['./configuracion.css'],
  imports: [CommonModule, FormsModule, ReactiveFormsModule]
})
export class Configuracion implements OnInit {
  @ViewChild('dialogModal') dialogModal!: ElementRef;
  @ViewChild('confirmModal') confirmModal!: ElementRef;
  esAdmin: boolean = false;
  // Datos
  configuraciones: Configuracionx[] = [];
  configuracionSeleccionada: Configuracionx | null = null;
  
  // Estados
  cargando = false;
  modoEdicion = false;
  totalRegistros = 0;
  paginaActual = 1;
  itemsPorPagina = 10;
  totalPaginas = 0;
  userPrivileges: string[] = [];
  // Búsqueda y filtros
  terminoBusqueda = '';
  filtroGrupo = 'todos';
  grupos: string[] = [];
  
  // Formulario
  configForm: FormGroup;
  submitted = false;
  claveExistente = false;
  
  // Confirmación
  accionConfirmacion: 'eliminar' | 'desactivar' | 'activar' = 'eliminar';
  mensajeConfirmacion = '';
  idConfirmacion: number | null = null;
  
  constructor(
    private configService: ConfiguracionesService,
    private fb: FormBuilder,
        private trazabilidadService: TrazabilidadService
  ) {
    this.configForm = this.fb.group({
      clave: ['', [Validators.required, Validators.pattern(/^[a-z0-9_.-]+$/)]],
      valor: [''],
      descripcion: ['']
    });
  }
  tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }
  ngOnInit() {
    this.cargarConfiguraciones();
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
  async cargarConfiguraciones() {
    try {
      this.cargando = true;
      
      const resultado = await this.configService.getConfiguraciones({
        search: this.terminoBusqueda,
        page: this.paginaActual,
        limit: this.itemsPorPagina
      });
      
      this.configuraciones = resultado.data;
      this.totalRegistros = resultado.count;
      this.totalPaginas = Math.ceil(this.totalRegistros / this.itemsPorPagina);
      
      // Extraer grupos únicos
      this.extraerGrupos();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    } finally {
      this.cargando = false;
    }
  }
  
  extraerGrupos() {
    const gruposSet = new Set<string>();
    
    this.configuraciones.forEach(config => {
      const partes = config.clave.split('.');
      if (partes.length > 1) {
        gruposSet.add(partes[0]);
      } else {
        gruposSet.add('general');
      }
    });
    
    this.grupos = Array.from(gruposSet).sort();
  }
  
  get configuracionesFiltradas() {
    if (this.filtroGrupo === 'todos') {
      return this.configuraciones;
    }
    
    return this.configuraciones.filter(config => {
      const grupo = config.clave.split('.')[0];
      return this.filtroGrupo === 'general' ? 
        !config.clave.includes('.') : 
        grupo === this.filtroGrupo;
    });
  }
  
  async verificarClaveExistente() {
    const clave = this.configForm.get('clave')?.value;
    if (!clave) return;
    
    if (this.modoEdicion && this.configuracionSeleccionada) {
      this.claveExistente = await this.configService.checkClaveExists(
        clave, 
        this.configuracionSeleccionada.id
      );
    } else {
      this.claveExistente = await this.configService.checkClaveExists(clave);
    }
  }
  
  abrirCrear() {
    this.modoEdicion = false;
    this.submitted = false;
    this.claveExistente = false;
    this.configForm.reset({
      clave: '',
      valor: '',
      descripcion: ''
    });
    
    const modal = this.dialogModal.nativeElement;
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
  }
  
  abrirEditar(config: Configuracionx) {
    this.modoEdicion = true;
    this.submitted = false;
    this.claveExistente = false;
    this.configuracionSeleccionada = config;
    
    this.configForm.patchValue({
      clave: config.clave,
      valor: config.valor || '',
      descripcion: config.descripcion || ''
    });
    
    const modal = this.dialogModal.nativeElement;
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
  }
  
  cerrarModal() {
    const modal = this.dialogModal.nativeElement;
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }
  
  async guardarConfiguracion() {
    this.submitted = true;
    
    if (this.configForm.invalid) {
      this.mostrarNotificacion('warning', 'Por favor complete los campos requeridos');
      return;
    }
    
    if (this.claveExistente) {
      this.mostrarNotificacion('error', 'Ya existe una configuración con esa clave');
      return;
    }
    
    try {
      const formValue = this.configForm.value;
      
      if (this.modoEdicion && this.configuracionSeleccionada) {
        await this.configService.updateConfiguracion(
          this.configuracionSeleccionada.id, 
          formValue
        );
        this.mostrarNotificacion('success', 'Configuración actualizada correctamente');
      } else {
        await this.configService.createConfiguracion(formValue);
        this.mostrarNotificacion('success', 'Configuración creada correctamente');
      }
      
      this.cerrarModal();
      await this.cargarConfiguraciones();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    }
  }
  
  confirmarEliminar(id: number, clave: string) {
    this.accionConfirmacion = 'eliminar';
    this.idConfirmacion = id;
    this.mensajeConfirmacion = `¿Está seguro de eliminar la configuración "${clave}"?`;
    
    const modal = this.confirmModal.nativeElement;
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
  }
  
  cerrarConfirmacion() {
    const modal = this.confirmModal.nativeElement;
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }
  
  async ejecutarConfirmacion() {
    if (!this.idConfirmacion) return;
    
    try {
      switch (this.accionConfirmacion) {
        case 'eliminar':
          await this.configService.eliminarConfiguracion(this.idConfirmacion);
          this.mostrarNotificacion('success', 'Configuración eliminada correctamente');
          break;
      }
      
      this.cerrarConfirmacion();
      await this.cargarConfiguraciones();
      
    } catch (error: any) {
      this.mostrarNotificacion('error', `Error: ${error.message}`);
    }
  }
  
  cambiarPagina(pagina: number) {
    if (pagina < 1 || pagina > this.totalPaginas) return;
    
    this.paginaActual = pagina;
    this.cargarConfiguraciones();
  }
  
  buscarConfiguraciones() {
    this.paginaActual = 1;
    this.cargarConfiguraciones();
  }
  
  limpiarBusqueda() {
    this.terminoBusqueda = '';
    this.paginaActual = 1;
    this.cargarConfiguraciones();
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
  
  mostrarNotificacion(tipo: 'success' | 'error' | 'warning', mensaje: string) {
    // Crear notificación dinámica
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
  
  get f() { return this.configForm.controls; }
  
  // Helper para truncar texto largo
  truncarTexto(texto: string | null, maxLength: number = 50): string {
    if (!texto) return '';
    return texto.length > maxLength ? texto.substring(0, maxLength) + '...' : texto;
  }
}