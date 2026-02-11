import { Component, ElementRef, ViewChild } from '@angular/core';
import { OnInit } from '@angular/core';
import { UbicacionesService } from '../../services/ubicaciones.service';
import { Ubicacionx } from '../../services/ubicaciones.service'; 
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ubicacion',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './ubicacion.html',
  styleUrls: ['./ubicacion.css'],
})
export class Ubicacion implements OnInit {
  // Control del modal personalizado
  mostrarModal: boolean = false;
 userPrivileges: string[] = [];
  // Método para abrir modal (para crear)
  abrirModal(): void {
    this.isEditing = false;
    this.ubicacionEditId = null;
    this.ubicacionForm.reset({
      nombre: '',
      descripcion: '',
      estado: 'activo'
    });
    this.mostrarModal = true;
  }

  // Método para cerrar modal
  cerrarModal(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.mostrarModal = false;
  }

  // Cambia el nombre de ubicacionesx a ubicaciones para consistencia
  ubicacionesx: Ubicacionx[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  
  // Propiedades para estadísticas
  totalRegistros = 0;
  ubicacionesActivas = 0;
  ubicacionesInactivas = 0;
  
  // Formulario
  ubicacionForm: FormGroup;
  isEditing = false;
  ubicacionEditId: number | null = null;
  
  // Filtros
  estados = ['todos', 'activo', 'inactivo'];
  filtroEstado = 'todos';
  filtroBusqueda = '';

  constructor(
    private ubicacionesService: UbicacionesService,
    private fb: FormBuilder
  ) {
    this.ubicacionForm = this.fb.group({
      nombre: ['', [Validators.required, Validators.minLength(3)]],
      descripcion: [''],
      estado: ['activo']
    });
  }

  async ngOnInit() {
    await this.cargarUbicaciones();
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
  async cargarUbicaciones() {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      // Obtener ubicaciones del servicio
      const result = await this.ubicacionesService.getUbicaciones({
        estado: this.filtroEstado === 'todos' ? undefined : this.filtroEstado,
        search: this.filtroBusqueda
      });
      
      this.ubicacionesx = result.data;
      this.totalRegistros = result.count || this.ubicacionesx.length;
      
      // Calcular estadísticas
      this.calcularEstadisticas();
      
      this.successMessage = `✅ ${this.ubicacionesx.length} ubicaciones cargadas`;
      
    } catch (error: any) {
      this.errorMessage = error.message;
      console.error('Error cargando ubicaciones:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Método para calcular estadísticas
  calcularEstadisticas() {
    this.ubicacionesActivas = this.ubicacionesx.filter(u => u.estado === 'activo').length;
    this.ubicacionesInactivas = this.ubicacionesx.filter(u => u.estado === 'inactivo').length;
  }

  // Método para editar ubicación (CORREGIDO)
  editarUbicacion(ubicacion: Ubicacionx) {
    this.isEditing = true;
    this.ubicacionEditId = ubicacion.id;
    this.ubicacionForm.patchValue({
      nombre: ubicacion.nombre,
      descripcion: ubicacion.descripcion,
      estado: ubicacion.estado
    });
    
    // Abrir modal personalizado (NO usar Bootstrap JS)
    this.mostrarModal = true;
    
    // Mostrar log para depuración
    console.log('✏️ Editando ubicación:', ubicacion);
  }

  async crearUbicacion() {
    if (this.ubicacionForm.invalid) {
      console.log('Formulario inválido:', this.ubicacionForm.errors);
      return;
    }
    
    this.isLoading = true;
    
    try {
      const formData = this.ubicacionForm.value;
      console.log('📤 Enviando datos:', formData);
      
      if (this.isEditing && this.ubicacionEditId) {
        console.log('🔄 Actualizando ubicación ID:', this.ubicacionEditId);
        await this.ubicacionesService.updateUbicacion(this.ubicacionEditId, formData);
        this.successMessage = '✅ Ubicación actualizada correctamente';
      } else {
        console.log('🆕 Creando nueva ubicación');
        await this.ubicacionesService.createUbicacion(formData);
        this.successMessage = '✅ Ubicación creada correctamente';
      }
      
      // Recargar la lista
      await this.cargarUbicaciones();
      
      // Cerrar modal
      this.mostrarModal = false;
      this.resetForm();
      
      // Mostrar mensaje de éxito temporalmente
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
      
    } catch (error: any) {
      console.error('❌ Error en crear/editar:', error);
      this.errorMessage = error.message || 'Error desconocido';
    } finally {
      this.isLoading = false;
    }
  }

  // Método resetForm actualizado
  resetForm() {
    this.ubicacionForm.reset({
      nombre: '',
      descripcion: '',
      estado: 'activo'
    });
    this.isEditing = false;
    this.ubicacionEditId = null;
    // NO poner mostrarModal = true aquí
  }

  async cambiarEstado(id: number, nuevoEstado: 'activo' | 'inactivo') {
    if (!confirm(`¿Estás seguro de cambiar el estado a ${nuevoEstado}?`)) return;
    
    try {
      if (nuevoEstado === 'activo') {
        await this.ubicacionesService.activarUbicacion(id);
      } else {
        await this.ubicacionesService.desactivarUbicacion(id);
      }
      
      this.successMessage = `✅ Estado cambiado a ${nuevoEstado}`;
      await this.cargarUbicaciones();
      
      // Limpiar mensaje después de 3 segundos
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
      
    } catch (error: any) {
      this.errorMessage = error.message;
    }
  }

  async eliminarUbicacion(id: number) {
    if (!confirm('¿Estás seguro de eliminar permanentemente esta ubicación?\nEsta acción no se puede deshacer.')) return;
    
    try {
      await this.ubicacionesService.eliminarUbicacion(id);
      this.successMessage = '✅ Ubicación eliminada correctamente';
      await this.cargarUbicaciones();
      
      // Limpiar mensaje después de 3 segundos
      setTimeout(() => {
        this.successMessage = '';
      }, 3000);
      
    } catch (error: any) {
      this.errorMessage = error.message;
    }
  }

  // Métodos para paginación
  getPagesArray(): number[] {
    this.totalPaginas = Math.ceil(this.totalRegistros / this.limit);
    const pages = [];
    const maxVisible = 5;
    
    let start = Math.max(1, this.page - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPaginas, start + maxVisible - 1);
    
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  // Propiedades para paginación
  page = 1;
  limit = 10;
  totalPaginas = 0;

  changePage(newPage: number) {
    if (newPage >= 1 && newPage <= this.totalPaginas && newPage !== this.page) {
      this.page = newPage;
      this.cargarUbicaciones();
    }
  }
tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }
  // Métodos para filtros
  aplicarFiltros() {
    this.page = 1;
    this.cargarUbicaciones();
  }

  limpiarFiltros() {
    this.filtroEstado = 'todos';
    this.filtroBusqueda = '';
    this.page = 1;
    this.cargarUbicaciones();
  }

  // Método para Math.min en template
  get mathMin() {
    return Math.min;
  }

  // Método para formatear fecha
  formatearFecha(fecha: string): string {
    return new Date(fecha).toLocaleDateString('es-ES');
  }
}