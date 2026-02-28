// components/inventario.component.ts
import { Component, OnInit, ViewChild, ElementRef, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ProductosService } from '../../services/productos.service';
import { TrazabilidadService } from '../../services/trazabilidad.service';
import { UbicacionesService } from '../../services/ubicaciones.service';
import { Pipe, PipeTransform } from '@angular/core';
import { NuevoMovimiento } from '../moldes/producto.model';
import { UsuariosService } from '../../services/usuarios.service';
import { AuthService } from '../../services/auth.service';
@Pipe({
  name: 'truncate',
  standalone: true
})
export class TruncatePipe implements PipeTransform {
  transform(value: string, limit: number = 30, trail: string = '...'): string {
    if (!value) return '';
    return value.length > limit ? value.substring(0, limit) + trail : value;
  }
}

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.html',
  styleUrls: ['./inventario.css'],
  imports: [CommonModule, FormsModule, ReactiveFormsModule]
})
export class Inventario implements OnInit {

  userName: string = 'Usuario';
  // En la sección de propiedades, añade:
  mostrandoModalMovimientoGrupal = false;

  formMovimientoGrupal = {
    ubicacion_destino: '',
    motivo: 'S.M',
    observaciones: '',
    estanteria: ''  // Solo si destino es BODEGA QUITO
  };

  procesandoGrupo = false;
  resultadoGrupo = {
    exitosos: 0,
    fallidos: 0,
    omitidos: 0,
    errores: [] as string[]
  };




  private async procesarMovimientoSeriadoIndividualSinAlerta(
    producto: any,
    destino: string,
    motivo: string,
    observaciones: string,
    estanteria: string
  ): Promise<boolean> {
    try {
      // Validar que no se mueva a la misma ubicación
      if (producto.ubicacion_nombre === destino) {
        console.log(`⏭️ Producto ${producto.id} ya está en la ubicación destino, se omite`);
        return false;
      }

      // Obtener ID de ubicación destino
      const ubicacionDestinoId = this.getUbicacionIdPorNombre(destino);
      if (!ubicacionDestinoId) throw new Error('Ubicación destino no válida');

      // Preparar datos de actualización
      const updateData: any = { ubicacion_id: ubicacionDestinoId };

      // Manejar estantería si destino es BODEGA QUITO
      if (ubicacionDestinoId === 9) {
        if (!estanteria?.trim()) throw new Error('Estantería obligatoria para BODEGA QUITO');
        updateData.estanteria = estanteria;
      } else {
        updateData.estanteria = '';
      }

      // Actualizar producto
      await this.productosService.updateProducto(producto.id, updateData);

      // Registrar movimiento
      const movimientoData: NuevoMovimiento = {
        tipo_evento: 'transferencia',
        producto_id: producto.id,
        cantidad: 1,
        estado_evento: 'completado',
        motivo: motivo,
        ubicacion_origen: producto.ubicacion_nombre,
        ubicacion_destino: destino,
        detalles: 'Movimiento grupal de seriados',
        observaciones: observaciones
      };
      await this.trazabilidadService.registrarMovimiento(movimientoData);

      return true;
    } catch (error) {
      console.error(`❌ Error moviendo producto ${producto.id}:`, error);
      throw error;
    }
  }

async moverGrupoSeriados() {
  try {
    // Validaciones iniciales
    const ids = Array.from(this.productosSeleccionados);
    if (ids.length === 0) {
      this.mostrarAlerta('Selecciona al menos un producto', 'warning');
      return;
    }
    if (!this.formMovimientoGrupal.ubicacion_destino) {
      this.mostrarAlerta('Selecciona una ubicación destino', 'error');
      return;
    }
    if (!this.formMovimientoGrupal.motivo.trim()) {
      this.mostrarAlerta('El motivo es obligatorio', 'error');
      return;
    }
    const ubicacionDestinoId = this.getUbicacionIdPorNombre(this.formMovimientoGrupal.ubicacion_destino);
    if (ubicacionDestinoId === 9 && !this.formMovimientoGrupal.estanteria?.trim()) {
      this.mostrarAlerta('La estantería es obligatoria para BODEGA QUITO', 'error');
      return;
    }

    this.procesandoGrupo = true;
    this.resultadoGrupo = { exitosos: 0, fallidos: 0, omitidos: 0, errores: [] };

    // Obtener productos completos
    const productosCompletos = await Promise.all(
      ids.map(id => this.productosService.getProductoById(id).catch(() => null))
    );
    const productosSeriados = productosCompletos.filter(p => p && p.serial_number);
    const omitidosNoSeriados = ids.length - productosSeriados.length;

    if (productosSeriados.length === 0) {
      this.mostrarAlerta('Ninguno de los productos seleccionados es seriado', 'warning');
      this.procesandoGrupo = false;
      return;
    }
const productosExitosos: any[] = [];
    // ---- 1. Obtener stock inicial TOTAL en Bodega Quito para cada part number ----
    const partNumbersUnicos = new Set<string>();
    for (const producto of productosSeriados) {
      if (producto?.part_number) {
        partNumbersUnicos.add(producto.part_number);
      }
    }

    const stockInicialPorPartNumber = new Map<string, number>();
    for (const partNumber of partNumbersUnicos) {
      const productosPart = await this.productosService.getProductosPorPartNumber(partNumber);
      const stockEnBodega = productosPart.filter(p => p.ubicacion_id === 9).length;
      stockInicialPorPartNumber.set(partNumber, stockEnBodega);
    }

    // ---- 2. Confirmar con el usuario ----
    const confirmMsg = `Se moverán ${productosSeriados.length} producto(s) seriado(s) a ${this.formMovimientoGrupal.ubicacion_destino}.` +
      (omitidosNoSeriados > 0 ? `\n${omitidosNoSeriados} no seriados serán omitidos.` : '') +
      '\n¿Continuar?';
    if (!confirm(confirmMsg)) {
      this.procesandoGrupo = false;
      return;
    }

    // ---- 3. Procesar cada producto seriado (realizar los movimientos) ----
    for (const producto of productosSeriados) {
      try {
        const exito = await this.procesarMovimientoSeriadoIndividualSinAlerta(
          producto,
          this.formMovimientoGrupal.ubicacion_destino,
          this.formMovimientoGrupal.motivo,
          this.formMovimientoGrupal.observaciones,
          this.formMovimientoGrupal.estanteria
        );
       if (exito) {
  this.resultadoGrupo.exitosos++;
  productosExitosos.push(producto); // <-- NUEVO
} else {
  this.resultadoGrupo.omitidos++;
}
      } catch (error: any) {
        this.resultadoGrupo.fallidos++;
        this.resultadoGrupo.errores.push(`Producto ID ${producto?.id}: ${error.message}`);
      }
    }

    // ---- 4. Verificación final de stock bajo en Bodega Quito ----
    console.log('=== INICIO VERIFICACIÓN FINAL ===');
    const umbral = await this.productosService.obtenerUmbralStockMinimo();

    for (const [partNumber, stockInicial] of stockInicialPorPartNumber) {
      // Obtener stock actual en Bodega Quito después de los movimientos
      const productosPart = await this.productosService.getProductosPorPartNumber(partNumber);
      const stockActual = productosPart.filter(p => p.ubicacion_id === 9).length;

      console.log(`PartNumber ${partNumber}: inicial=${stockInicial}, actual=${stockActual}`);

      // Solo enviar alerta si ANTES no estaba bajo y AHORA sí lo está
      if (stockInicial > umbral && stockActual <= umbral) {
        const agrupado = await this.productosService.getProductoAgrupadoPorPartNumber(partNumber);
        if (!agrupado) {
          console.warn(`No se pudo obtener agrupado para ${partNumber}`);
          continue;
        }

        const productoReferencia = productosPart.find(p => p.ubicacion_id === 9) || productosPart[0] || agrupado;

        const productoAlerta = {
          id: productoReferencia.id,
          nombre: productoReferencia.nombre,
          codigo: productoReferencia.codigo,
          part_number: partNumber,
          serial_number: productosPart
            .filter(p => p.ubicacion_id === 9)
            .map(p => p.serial_number)
            .filter(s => s)
            .join(', '),
          cantidad_actual: stockActual,
          ubicacion_nombre: 'BODEGA QUITO',
          precio: productoReferencia.precio,
          criticidad: productoReferencia.criticidad,
          componente: productoReferencia.componente,
          fecha_adquisicion: productoReferencia.fecha_adquisicion,
          orden_envio: productoReferencia.orden_envio,
          factura: productoReferencia.factura,
          observaciones: productoReferencia.observaciones,
          cantidad_items: productosPart.length
        };

        console.log(`📧 Enviando alerta para ${partNumber}:`, productoAlerta);
        await this.productosService.enviarAlertaProductoIndividual(productoAlerta);
      } else {
        console.log(`No alerta para ${partNumber}: inicial ${stockInicial}, actual ${stockActual}, umbral ${umbral}`);
      }
    }
    console.log('=== FIN VERIFICACIÓN FINAL ===');
// Enviar reporte grupal si hay productos movidos
if (productosExitosos.length > 0) {
  const detalleMovimiento = {
    tipo: 'Movimiento grupal de seriados',
    motivo: this.formMovimientoGrupal.motivo,
    observaciones: this.formMovimientoGrupal.observaciones,
    usuario: this.userName,
    productos: productosExitosos.map(p => ({
      id: p.id,
      nombre: p.nombre,
      codigo: p.codigo,
      part_number: p.part_number,
      serial_number: p.serial_number,
      cantidad: 1, // cada seriado se mueve de a 1
      ubicacion_origen: p.ubicacion_nombre,
      ubicacion_destino: this.formMovimientoGrupal.ubicacion_destino
    }))
  };
  this.productosService.enviarReporteMovimiento(detalleMovimiento).catch(err =>
    console.error('Error enviando reporte de movimiento grupal:', err)
  );
}
    // ---- 5. Mostrar resultado y limpiar ----
    this.mostrarAlerta(
      `✅ Movidos: ${this.resultadoGrupo.exitosos} | ⏭️ Omitidos: ${this.resultadoGrupo.omitidos} | ❌ Fallos: ${this.resultadoGrupo.fallidos}`,
      this.resultadoGrupo.fallidos > 0 ? 'warning' : 'success'
    );

    this.cerrarModalMovimientoGrupal();
    this.productosSeleccionados.clear();
    await this.cargarProductos();
    await this.cargarEstadisticas();

  } catch (error: any) {
    this.mostrarAlerta(`Error inesperado: ${error.message}`, 'error');
  } finally {
    this.procesandoGrupo = false;
  }
}

  // Métodos para abrir/cerrar el modal grupal
  abrirModalMovimientoGrupal() {
    if (this.productosSeleccionados.size === 0) {
      this.mostrarAlerta('Selecciona al menos un producto', 'warning');
      return;
    }
    this.mostrandoModalMovimientoGrupal = true;
  }

  cerrarModalMovimientoGrupal() {
    this.mostrandoModalMovimientoGrupal = false;
    this.formMovimientoGrupal = {
      ubicacion_destino: '',
      motivo: 'S.M',
      observaciones: '',
      estanteria: ''
    };
  }
async cargarUsuarioActual() {
  try {


      const session = await this.authService.getCurrentSession();
       if (!session?.user) {
        return;
      }

      const userId = session.user.id;
     const perfil = await this.usuariosService.getUsuarioById(userId);

      // Asignar el nombre
      if (perfil?.nombre_completo) {
        this.userName = perfil.nombre_completo;
      }
  } catch (error) {
    console.error('Error cargando usuario actual:', error);
  }
}





 


















  eliminandoMasivo = false;

  // Agrega en las propiedades
  async eliminarMasivoCondicional() {
    try {
      // 1. Determinar qué IDs procesar
      let idsAEvaluar: number[] = [];

      if (this.formEdicionMultiCampo.aplicarATodos) {
        idsAEvaluar = await this.obtenerTodosLosIdsFiltrados();
        if (idsAEvaluar.length === 0) {
          this.mostrarAlerta('No hay productos con los filtros actuales', 'warning');
          return;
        }
      } else {
        idsAEvaluar = Array.from(this.productosSeleccionados);
        if (idsAEvaluar.length === 0) {
          this.mostrarAlerta('Selecciona al menos un producto', 'warning');
          return;
        }
      }

      this.eliminandoMasivo = true;

      // 2. Obtener los productos completos
      const productosCompletos = await Promise.all(
        idsAEvaluar.map(id => this.productosService.getProductoById(id).catch(() => null))
      );

      // 3. Filtrar solo los que tienen estado CONDENADO
      const productosCondenados = productosCompletos.filter(p => p && p.estado?.toUpperCase() === 'CONDENADO');

      if (productosCondenados.length === 0) {
        this.mostrarAlerta('Ninguno de los productos seleccionados tiene estado CONDENADO', 'warning');
        return;
      }

      const omitidos = idsAEvaluar.length - productosCondenados.length;
      const mensajeConfirm = `Se eliminarán ${productosCondenados.length} producto(s) con estado CONDENADO.` +
        (omitidos > 0 ? ` ${omitidos} producto(s) no se eliminarán por no estar CONDENADOS.` : '') +
        '\n\n¿Continuar?';

      if (!confirm(mensajeConfirm)) {
        return;
      }

      // 4. Procesar eliminaciones SECUENCIALMENTE
      this.loading = true;
      let exitosos = 0;
      let fallidos = 0;
      let alertasEnviadas = 0;

      for (const producto of productosCondenados) {
        try {
          const resultado = await this.eliminarUnProductoConVerificacion(producto);
          exitosos++;
          if (resultado.alertaEnviada) alertasEnviadas++;
        } catch (error) {
          console.error(`Error eliminando producto ${producto?.id}:`, error);
          fallidos++;
        }
      }

      // 5. Mostrar resultado
      this.mostrarAlerta(
        `✅ Eliminados: ${exitosos} producto(s) CONDENADO${exitosos !== 1 ? 's' : ''}. ` +
        (fallidos > 0 ? `❌ Fallos: ${fallidos}.` : '') +
        (omitidos > 0 ? ` ⏭️ Omitidos (no CONDENADOS): ${omitidos}.` : '') +
        (alertasEnviadas > 0 ? ` 📧 Alertas enviadas: ${alertasEnviadas}.` : ''),
        fallidos > 0 ? 'warning' : 'success'
      );

      // 6. Limpiar selección y cerrar modal
      this.productosSeleccionados.clear();
      this.cerrarEdicionMultiCampo();

      // 7. Recargar datos
      await this.cargarProductos();
      await this.cargarEstadisticas();

    } catch (error: any) {
      console.error('❌ Error en eliminación masiva:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.eliminandoMasivo = false;
      this.loading = false;
    }
  }


  productoEsSeriado: boolean = false;


  esRepuestoSeriado: boolean = false;
  partNumberBuscar: string = '';
  productosEncontrados: any[] = [];
  productoSeleccionadoExistente: any = null;
  buscandoProducto: boolean = false;
  busquedaRealizada: boolean = false;
  clonandoDeProductoExistente: boolean = false;
  cantidadAnterior: any;



  // Método cuando cambia el checkbox de repuesto seriado
  // Método cuando cambia el checkbox de repuesto seriado
  // Método cuando cambia el checkbox de repuesto seriado - CORREGIDO
  onRepuestoSeriadoChange() {
    if (this.esRepuestoSeriado) {
      // Si se marca como repuesto seriado:
      // 1. Establecer cantidad en 1
      this.formProducto.cantidad_actual = 1;

      // 2. Limpiar código (ya que no es obligatorio para seriados)
      this.formProducto.codigo = '';

      // 3. Mostrar mensaje informativo
      console.log('✅ Repuesto marcado como seriado. Cantidad fijada en 1.');
    } else {
      // Si se desmarca:
      // 1. Resetear cantidad a null o 1, NO a 0
      this.formProducto.cantidad_actual = 1; // O null si prefieres

      // 2. Mantener el código si ya tenía valor
      // No lo limpiamos automáticamente

      // 3. Mostrar mensaje informativo
      console.log('✅ Repuesto marcado como NO seriado. Ingrese cantidad y código.');
    }

    // Limpiar la búsqueda de productos existentes si se desmarca
    if (!this.esRepuestoSeriado) {
      this.partNumberBuscar = '';
      this.productosEncontrados = [];
      this.productoSeleccionadoExistente = null;
      this.clonandoDeProductoExistente = false;
      this.busquedaRealizada = false;
    }
  }
  // Método para buscar productos por Part Number
  // Método para buscar productos por Part Number (modificado)
  async buscarPorPartNumber() {
    if (!this.partNumberBuscar.trim()) {
      this.mostrarAlerta('Ingresa un Part Number para buscar', 'warning');
      return;
    }

    try {
      this.buscandoProducto = true;
      this.busquedaRealizada = false;
      this.productosEncontrados = []; // Limpiar lista

      // Usar el servicio para buscar productos por Part Number
      const productos = await this.productosService.buscarProductos(this.partNumberBuscar);

      // Filtrar para obtener solo los que coinciden exactamente con el Part Number
      const productosFiltrados = productos.filter(p =>
        p.part_number?.toLowerCase() === this.partNumberBuscar.toLowerCase()
      );

      this.busquedaRealizada = true;

      if (productosFiltrados.length > 0) {
        // TOMAR AUTOMÁTICAMENTE EL PRIMER PRODUCTO ENCONTRADO
        const primerProducto = productosFiltrados[0];
        this.seleccionarProductoExistente(primerProducto);

        // Mostrar mensaje indicando que se clonó el primer producto

      } else {
        this.mostrarAlerta('No se encontraron repuestos con este Part Number', 'warning');
      }

    } catch (error: any) {
      console.error('Error buscando repuesto:', error);
      this.mostrarAlerta(`Error al buscar: ${error.message}`, 'error');
    } finally {
      this.buscandoProducto = false;
    }
  }

  // Método para seleccionar un producto existente y clonar sus datos
  seleccionarProductoExistente(producto: any) {
    // Guardar referencia del producto seleccionado
    this.productoSeleccionadoExistente = producto;
    this.clonandoDeProductoExistente = true;

    // Clonar los datos del producto seleccionado
    this.formProducto.nombre = producto.nombre;
    this.formProducto.descripcion = producto.descripcion || '';
    this.formProducto.componente = producto.componente || '';
    this.formProducto.criticidad = producto.criticidad;
    this.formProducto.part_number = producto.part_number; // Mantener el mismo Part Number
    this.formProducto.codigo = producto.codigo || '';

    // Dejar el serial number vacío - el usuario DEBE ingresar uno nuevo
    this.formProducto.serial_number = '';

    this.formProducto.estado = producto.estado;
    this.formProducto.cantidad_actual = 1; // Para repuesto seriado,  
    this.formProducto.ubicacion_id = producto.ubicacion_id;
    this.formProducto.estanteria = producto.estanteria || '';
    this.formProducto.precio = producto.precio;
    this.formProducto.fecha_adquisicion = producto.fecha_adquisicion || '';
    this.formProducto.observaciones = producto.observaciones || '';

    // Mostrar mensaje informativo
    this.mostrarAlerta(
      `Datos clonados del repuesto "${producto.nombre}". Ahora ingresa un Serial Number único para este nuevo repuesto.`,
      'success'
    );
  }














  mostrandoModalImportacion = false;
  abrirModalImportacion() {
    this.mostrandoModalImportacion = true;
  }
  @ViewChild('archivoImportInput') archivoImportInput!: ElementRef<HTMLInputElement>;
  // Control de importación (múltiples archivos)
  archivosImportacion: File[] = [];          // Array de archivos seleccionados
  importando = false;
  resultadoImportacion: {
    total: number;
    creados: number;
    errores: Array<{ archivo: string; fila: number; error: string }>;
  } | null = null;

  progresoImportacion = {
    archivoActual: 0,        // Índice del archivo que se está procesando
    totalArchivos: 0,
    archivoNombre: '',
    filasProcesadas: 0,
    totalFilas: 0,
    porcentaje: 0
  };

  // Asegúrate de que cerrarModalImportacion limpie todo:
  cerrarModalImportacion() {
    this.mostrandoModalImportacion = false;
    this.archivosImportacion = [];
    this.resultadoImportacion = null;
    this.importando = false;
    this.progresoImportacion = { archivoActual: 0, totalArchivos: 0, filasProcesadas: 0, totalFilas: 0, porcentaje: 0, archivoNombre: '' };
    if (this.archivoImportInput) {
      this.archivoImportInput.nativeElement.value = '';
    }
  }
  archivoImportacion: File | null = null;

  // Propiedades para el modal de imagen
  imagenModal = {
    mostrar: false,
    url: '',
    titulo: ''
  };

  // En inventario.component.ts, modifica estos métodos:
  // Método para ver imagen (URL pública directa)
  verImagen(url: string, titulo: string = '') {
    if (!url) return;

    console.log('🔍 Abriendo imagen:', url);

    this.imagenModal = {
      mostrar: true,
      url: url,  // URL pública directa
      titulo: titulo
    };
  }

  // Método para descargar imagen (URL pública directa)
  // Método mejorado con fetch para descarga directa
  async descargarImagen(url: string, nombreArchivo: string = 'documento') {
    if (!url) return;

    try {
      console.log('💾 Descargando archivo:', url);

      // Mostrar indicador de carga
      this.loading = true;

      // 1. Obtener archivo como blob
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Error al obtener archivo: ${response.status}`);
      }

      const blob = await response.blob();

      // 2. Agregar extensión automáticamente
      const extension = this.getFileExtension(url);
      if (extension && !nombreArchivo.toLowerCase().endsWith(`.${extension}`)) {
        nombreArchivo += `.${extension}`;
      }

      // 3. Crear objeto URL local para descarga
      const blobUrl = window.URL.createObjectURL(blob);

      // 4. Crear enlace y simular clic
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = nombreArchivo;
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 5. Liberar objeto URL
      window.URL.revokeObjectURL(blobUrl);

      this.mostrarAlerta('Descarga completada', 'success');

    } catch (error: any) {
      console.error('Error descargando imagen:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }

  // Método auxiliar para obtener extensión
  private getFileExtension(url: string): string | null {
    const match = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return match ? match[1].toLowerCase() : null;
  }
  // Métodos auxiliares para el modal
  esImagen(url: string): boolean {
    if (!url) return false;
    const extensiones = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    return extensiones.some(ext => url.toLowerCase().includes(ext));
  }

  esPdf(url: string): boolean {
    if (!url) return false;
    return url.toLowerCase().includes('.pdf');
  }

  mostrarAlertaNoPrevisualizable(url: string): boolean {
    if (!url) return false;
    return !this.esImagen(url) && !this.esPdf(url);
  }

  onArchivoImportacionSelected(event: any) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const archivosValidos: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Validar extensión
      const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      if (!['.xlsx', '.xls'].includes(extension)) {
        this.mostrarAlerta(`El archivo "${file.name}" no es un Excel válido`, 'error');
        continue;
      }
      // Validar tamaño (10MB)
      if (file.size > 10 * 1024 * 1024) {
        this.mostrarAlerta(`El archivo "${file.name}" excede los 10MB`, 'error');
        continue;
      }
      archivosValidos.push(file);
    }

    this.archivosImportacion = archivosValidos;
    this.resultadoImportacion = null;

    if (archivosValidos.length > 0) {
      console.log(`📂 ${archivosValidos.length} archivo(s) seleccionado(s)`);
    }
  }

  // Método para descargar plantilla
  async descargarPlantilla() {
    try {
      this.loading = true;
      await this.productosService.descargarPlantillaImportacion();
      this.mostrarAlerta('Plantilla descargada. Revise las instrucciones.', 'success');
    } catch (error: any) {
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }

  // Método para ejecutar importación
  // En tu inventario.component.ts

  // Modifica el método ejecutarImportacion:
  async ejecutarImportacion() {
    if (this.archivosImportacion.length === 0) {
      this.mostrarAlerta('Selecciona al menos un archivo Excel', 'error');
      return;
    }

    try {
      this.importando = true;
      this.loading = true;

      // Inicializar progreso global
      this.progresoImportacion = {
        archivoActual: 0,
        totalArchivos: this.archivosImportacion.length,
        archivoNombre: '',
        filasProcesadas: 0,
        totalFilas: 0,
        porcentaje: 0
      };

      let totalCreados = 0;
      let totalRegistros = 0;
      let totalErrores: Array<{ archivo: string; fila: number; error: string }> = [];

      // Procesar cada archivo
      for (let i = 0; i < this.archivosImportacion.length; i++) {
        const archivo = this.archivosImportacion[i];

        this.progresoImportacion.archivoActual = i + 1;
        this.progresoImportacion.archivoNombre = archivo.name;
        this.progresoImportacion.filasProcesadas = 0;
        this.progresoImportacion.totalFilas = 0;
        this.progresoImportacion.porcentaje = 0;

        console.log(`📄 Procesando archivo ${i + 1}/${this.archivosImportacion.length}: ${archivo.name}`);

        const resultadoArchivo = await this.productosService.importarDesdeExcel(
          archivo,
          (procesadas, total) => {
            this.progresoImportacion.filasProcesadas = procesadas;
            this.progresoImportacion.totalFilas = total;
            this.cdRef.detectChanges();   // 👈 Forzar actualización
          }
        );

        // Acumular resultados
        totalCreados += resultadoArchivo.creados;
        totalRegistros += resultadoArchivo.total;
        totalErrores = [
          ...totalErrores,
          ...resultadoArchivo.errores.map(e => ({
            archivo: archivo.name,
            fila: e.fila,
            error: e.error
          }))
        ];
      }

      // Resultado final
      this.resultadoImportacion = {
        total: totalRegistros,
        creados: totalCreados,
        errores: totalErrores
      };

      // Recargar datos
      await this.cargarProductos();
      await this.cargarEstadisticas();

      this.mostrarAlerta(
        `✅ Importación completada: ${totalCreados} repuestos creados en ${this.archivosImportacion.length} archivo(s).`,
        'success'
      );

      // Cerrar modal después de 4 segundos
      setTimeout(() => this.cerrarModalImportacion(), 4000);

    } catch (error: any) {
      console.error('❌ Error en importación:', error);
      this.mostrarAlerta(`Error al importar: ${error.message}`, 'error');
      setTimeout(() => this.cerrarModalImportacion(), 4000);
    } finally {
      this.importando = false;
      this.loading = false;
    }
  }
  // Método para cancelar importación
  cancelarImportacion() {
    this.archivoImportacion = null;
    this.resultadoImportacion = null;

    const fileInput = document.getElementById('archivoImportacion') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }
  // Cerrar modal
  cerrarModalImagen() {
    this.imagenModal.mostrar = false;
    this.imagenModal.url = '';
    this.imagenModal.titulo = '';
  }
  ordenEnvioFile: File | null = null;
  facturaFile: File | null = null;
  ordenEnvioPreview: string | null = null;
  facturaPreview: string | null = null;
  // Método para seleccionar orden de envío
  onOrdenEnvioSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tamaño (5MB máximo)
    if (file.size > 5 * 1024 * 1024) {
      this.mostrarAlerta('El archivo es demasiado grande. Máximo 5MB', 'error');
      return;
    }

    // Validar tipo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.mostrarAlerta('Tipo de archivo no permitido. Solo imágenes y PDF', 'error');
      return;
    }

    this.ordenEnvioFile = file;

    // Crear previsualización si es imagen
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.ordenEnvioPreview = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      this.ordenEnvioPreview = null;
    }
  }

  // Método para seleccionar factura
  onFacturaSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tamaño (5MB máximo)
    if (file.size > 5 * 1024 * 1024) {
      this.mostrarAlerta('El archivo es demasiado grande. Máximo 5MB', 'error');
      return;
    }

    // Validar tipo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.mostrarAlerta('Tipo de archivo no permitido. Solo imágenes y PDF', 'error');
      return;
    }

    this.facturaFile = file;

    // Crear previsualización si es imagen
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.facturaPreview = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      this.facturaPreview = null;
    }
  }
  // En la sección de estadísticas, agrega:
  // En la definición de estadisticasPorEstado, cambia:
  estadisticasPorEstado = {
    NUEVO: 0,
    UTIL: 0,
    MANTENIMIENTO_BANCO_DE_PRUEBAS: 0,
    MANTENIMIENTO_FABRICA: 0,
    PROCESO_DE_EXPORTACION_MODALTRADE: 0,
    CUARENTENA_BODEGA: 0,
    CONDENADO: 0
  };

  // Método para calcular productos por estado
  // En tu componente TypeScript, modifica el método calcularEstadisticasPorEstado()
  async calcularEstadisticasPorEstado() {
    try {
      // Resetear contadores para los 7 estados
      this.estadisticasPorEstado = {
        NUEVO: 0,
        UTIL: 0,
        MANTENIMIENTO_BANCO_DE_PRUEBAS: 0,
        MANTENIMIENTO_FABRICA: 0,
        PROCESO_DE_EXPORTACION_MODALTRADE: 0,
        CUARENTENA_BODEGA: 0,
        CONDENADO: 0
      };

      // Obtener TODOS los productos sin paginación ni filtros
      const resultado = await this.productosService.getProductos({
        limit: 10000, // Número grande para obtener todos
        page: 1,
        orderBy: 'id',
        orderDir: 'desc'
      });

      // Contar productos por estado exacto
      resultado.data.forEach(producto => {
        const estado = producto.estado;

        // Mapear estados exactos
        switch (estado) {
          case 'NUEVO':
            this.estadisticasPorEstado.NUEVO++;
            break;
          case 'ÚTIL':
            this.estadisticasPorEstado.UTIL++;
            break;
          case 'MANTENIMIENTO BANCO DE PRUEBAS':
            this.estadisticasPorEstado.MANTENIMIENTO_BANCO_DE_PRUEBAS++;
            break;
          case 'MANTENIMIENTO FÁBRICA':
            this.estadisticasPorEstado.MANTENIMIENTO_FABRICA++;
            break;
          case 'PROCESO DE EXPORTACIÓN (MODALTRADE)':
            this.estadisticasPorEstado.PROCESO_DE_EXPORTACION_MODALTRADE++;
            break;
          case 'CUARENTENA BODEGA':
            this.estadisticasPorEstado.CUARENTENA_BODEGA++;
            break;
          case 'CONDENADO':
            this.estadisticasPorEstado.CONDENADO++;
            break;
        }
      });

      // DEPURACIÓN: Verificar conteos
      console.log('📊 Estadísticas por estado (total):', this.estadisticasPorEstado);
      console.log('🔢 Total productos analizados:', resultado.data.length);

    } catch (error) {
      console.error('Error calculando estadísticas por estado:', error);
      // Fallback: contar solo los productos cargados actualmente
      this.calcularEstadisticasDesdeProductosLocales();
    }
  }

  // Método de respaldo si falla la consulta
  calcularEstadisticasDesdeProductosLocales() {
    try {
      this.estadisticasPorEstado = {
        NUEVO: 0,
        UTIL: 0,
        MANTENIMIENTO_BANCO_DE_PRUEBAS: 0,
        MANTENIMIENTO_FABRICA: 0,
        PROCESO_DE_EXPORTACION_MODALTRADE: 0,
        CUARENTENA_BODEGA: 0,
        CONDENADO: 0
      };

      this.productos.forEach(producto => {
        const estado = producto.estado;

        switch (estado) {
          case 'NUEVO':
            this.estadisticasPorEstado.NUEVO++;
            break;
          case 'UTIL':
            this.estadisticasPorEstado.UTIL++;
            break;
          case 'MANTENIMIENTO BANCO DE PRUEBAS':
            this.estadisticasPorEstado.MANTENIMIENTO_BANCO_DE_PRUEBAS++;
            break;
          case 'MANTENIMIENTO FÁBRICA':
            this.estadisticasPorEstado.MANTENIMIENTO_FABRICA++;
            break;
          case 'PROCESO DE EXPORTACIÓN (MODALTRADE)':
            this.estadisticasPorEstado.PROCESO_DE_EXPORTACION_MODALTRADE++;
            break;
          case 'CUARENTENA BODEGA':
            this.estadisticasPorEstado.CUARENTENA_BODEGA++;
            break;
          case 'CONDENADO':
            this.estadisticasPorEstado.CONDENADO++;
            break;
        }
      });

      console.log('📊 Estadísticas por estado (local - paginado):', this.estadisticasPorEstado);
      console.warn('⚠️ Se usaron solo los productos de la página actual. Los totales pueden no ser exactos.');

    } catch (error) {
      console.error('Error en cálculo local:', error);
    }
  }





  // Método para contar productos con criticidad 'Critico'
  contarCriticos(): number {
    try {
      if (!this.productos || this.productos.length === 0) {
        return 0;
      }

      // Contar productos con criticidad 'Critico' (insensible a mayúsculas/minúsculas)
      const criticos = this.productos.filter(producto =>
        producto.criticidad &&
        producto.criticidad.toString().toUpperCase() === 'CRÍTICO'
      );

      return criticos.length;

    } catch (error) {
      console.error('Error contando productos críticos:', error);
      return 0;
    }
  }







  onUbicacionChange(event: any) {
    // Convertir el valor a número
    this.formProducto.ubicacion_id = Number(event);

  }


  validarYGuardar(event: Event) {
    // Validaciones rápidas antes de enviar
    const errores: string[] = [];

    // Validar estantería para BODEGA QUITO
    if (this.formProducto.ubicacion_id === 9 && !this.formProducto.estanteria?.trim()) {
      errores.push('Estantería (obligatoria para BODEGA QUITO)');
    }

    // Validaciones para no seriados
    if (!this.esRepuestoSeriado) {
      if (!this.formProducto.codigo?.trim()) {
        errores.push('Código');
      }
      if (!this.formProducto.cantidad_actual || this.formProducto.cantidad_actual < 1) {
        errores.push('Cantidad mínima 1');
      }
    }

    // Validaciones para seriados
    if (this.esRepuestoSeriado) {
      if (!this.formProducto.serial_number?.trim()) {
        errores.push('Serial Number');
      }
      if (!this.formProducto.part_number?.trim()) {
        errores.push('Part Number');
      }
    }

    if (errores.length > 0) {
      event.preventDefault();
      this.mostrarAlerta(
        `Complete los siguientes campos:\n\n• ${errores.join('\n• ')}`,
        'warning'
      );
    } else {
    }
  }
  // Control de paginación
  showPagination: boolean = true;

  // Privilegios del usuario
  userPrivileges: string[] = [];

  // Estados
  vistaActual: 'lista' | 'formulario' | 'detalle' | 'movimientos' = 'lista';
  modoFormulario: 'crear' | 'editar' = 'crear';

  // Datos
  productos: any[] = [];
  productoSeleccionado: any = null;
  movimientosProducto: any[] = [];
  ubicaciones: any[] = [];

  // Filtros
  filtros = {
    search: '',
    estado: 'todos',
    criticidad: 'todos',
    ubicacion_id: 0,
    componente: 'todos',      // ← NUEVA LÍNEA
    bajo_stock: false,
    page: 1,
    limit: 20,
    orderBy: 'id',
    orderDir: 'desc' as 'asc' | 'desc'
  };
  componentesDisponibles: string[] = [
    'RA',
    'GAREX/SCV',
    'MYC',
    'SATCOM',
    'COMMS',
    'CAMIONES',
    'AA',
    'GENERADORES',
    'UPS'
  ];
  // Paginación
  totalProductos = 0;
  totalPaginas = 0;
  paginas: number[] = [];

  // Estadísticas
  estadisticas = {
    total: 0,
    activos: 0,
    bajoStock: 0,
    agotados: 0,
    valorTotal: 0,
    criticos: 0   // ← agregar esta línea
  };

  // Formulario de producto
  formProducto = {
    id: 0,
    nombre: '',
    descripcion: '',
    componente: '',
    criticidad: 'MEDIA' as 'BAJA' | 'MEDIA' | 'ALTA' | 'CRÍTICO',
    part_number: '',
    codigo: '',
    serial_number: '',
    estado: 'NUEVO' as 'NUEVO' | 'ÚTIL' | 'MANTENIMIENTO BANCO DE PRUEBAS' | 'MANTENIMIENTO FÁBRICA' | 'PROCESO DE EXPORTACIÓN (MODALTRADE)' | 'CUARENTENA BODEGA' | 'CONDENADO',
    cantidad_actual: 1,
    ubicacion_id: 0 as number | 0,
    estanteria: '',
    precio: 0 as number | 0,
    fecha_adquisicion: '',
    orden_envio: '',
    factura: '',
    observaciones: ''
  };




  // Método para verificar si la ubicación destino es BODEGA QUITO
  esDestinoBodegaQuito(): boolean {
    if (!this.formMovimiento.ubicacion_destino) {
      return false;
    }

    // Buscar la ubicación por nombre
    const ubicacion = this.ubicaciones.find(u => u.nombre === this.formMovimiento.ubicacion_destino);

    // Si encontramos la ubicación y su id es 9, es BODEGA QUITO
    return ubicacion ? ubicacion.id === 9 : false;
  }
  // Formulario movimiento COMPLETO
  // Formulario movimiento COMPLETO - AÑADE estanteria
  formMovimiento = {
    tipo_evento: 'transferencia' as 'entrada' | 'salida' | 'ajuste' | 'transferencia' | 'consumo' | 'devolucion',
    producto_id: 0,
    cantidad: 1,
    estado_evento: 'completado' as 'completado' | 'pendiente' | 'cancelado',
    motivo: 'S.M',
    ubicacion_origen: '' as string | null,
    ubicacion_destino: '' as string | null,
    estanteria: '', // <-- NUEVO CAMPO AQUÍ
    detalles: '',
    observaciones: ''
  };


  // Loading
  loading = false;
  loadingProductos = false;
  loadingMovimientos = false;









  productosSeleccionados = new Set<number>();
  mostrandoEdicionMultiCampo = false;
  formEdicionMasiva = {
    campo: '',
    valor: '',
    motivo: 'Actualización masiva',
    aplicarATodos: false
  };

  formEdicionMultiCampo = {
    campos: [] as Array<{ campo: string, valor: any }>,
    motivo: 'Actualización masiva múltiple',
    aplicarATodos: false
  };
  camposEditables: Array<{
    id: string;
    nombre: string;
    tipo: string;
    opciones?: any[];
    placeholder?: string;
  }> = [
      // Campos básicos
      { id: 'nombre', nombre: 'Nombre', tipo: 'text', placeholder: 'Nuevo nombre' },
      { id: 'descripcion', nombre: 'Descripción', tipo: 'textarea', placeholder: 'Nueva descripción' },
      { id: 'componente', nombre: 'Componente', tipo: 'text', placeholder: 'Nuevo componente' },

      // Campos de stock
      { id: 'cantidad_actual', nombre: 'Stock Actual', tipo: 'number', placeholder: 'Ej: 100' },

      // Campos de categorización
      { id: 'estado', nombre: 'Estado', tipo: 'select', opciones: ['NUEVO', 'UTIL', 'MANTENIMIENTO BANCO DE PRUEBAS', 'MANTENIMIENTO FÁBRICA', 'PROCESO DE EXPORTACIÓN (MODALTRADE)', 'CUARENTENA BODEGA', 'CONDENADO'] },
      { id: 'criticidad', nombre: 'Criticidad', tipo: 'select', opciones: ['Bajo', 'Medio', 'Alto', 'Critico'] },
      { id: 'ubicacion_id', nombre: 'Ubicación', tipo: 'select', opciones: [] },
      { id: 'estanteria', nombre: 'Estanteria', tipo: 'textarea', placeholder: 'Nueva estanteria' },
      { id: 'componente', nombre: 'Componente', tipo: 'select', opciones: ['RA', 'GAREX/SCV', 'MYC', 'SATCOM', 'COMMS', 'CAMIONES', 'AA', 'GENERADORES', 'UPS'] },
      // Campos de identificación
      { id: 'part_number', nombre: 'Part Number', tipo: 'text', placeholder: 'Ej: PN-12345' },
      { id: 'codigo', nombre: 'Código', tipo: 'text', placeholder: 'Nuevo código' },
      { id: 'serial_number', nombre: 'Serial Number', tipo: 'text', placeholder: 'Ej: SN-78901' },

      // Campos financieros
      { id: 'precio', nombre: 'Precio', tipo: 'number', placeholder: 'Ej: 99.99' },

      // Campos de fechas
      { id: 'fecha_adquisicion', nombre: 'Fecha Adquisición', tipo: 'date' },

      // Campos de texto libre
      { id: 'observaciones', nombre: 'Observaciones', tipo: 'textarea', placeholder: 'Nuevas observaciones' }
    ];









  // ==================== MÉTODOS PARA EDICIÓN MULTICAMPO ====================

  // Abrir modal de edición múltiple
  abrirEdicionMultiCampo() {
    if (this.productosSeleccionados.size === 0 && !this.formEdicionMultiCampo.aplicarATodos) {
      this.mostrarAlerta('Selecciona al menos un producto', 'warning');
      return;
    }

    // Inicializar con un campo vacío
    this.formEdicionMultiCampo.campos = [{ campo: '', valor: '' }];
    this.mostrandoEdicionMultiCampo = true;
  }

  // Cerrar modal de edición múltiple
  cerrarEdicionMultiCampo() {
    this.mostrandoEdicionMultiCampo = false;
    this.formEdicionMultiCampo = {
      campos: [],
      motivo: 'Actualización masiva múltiple',
      aplicarATodos: false
    };
  }

  // Agregar nuevo campo a editar
  agregarCampoEdicion() {
    this.formEdicionMultiCampo.campos.push({ campo: '', valor: '' });
  }

  // Eliminar campo de edición
  eliminarCampoEdicion(index: number) {
    if (this.formEdicionMultiCampo.campos.length > 1) {
      this.formEdicionMultiCampo.campos.splice(index, 1);
    }
  }

  // Obtener nombre del campo para mostrar
  getNombreCampo(id: string): string {
    const campo = this.camposEditables.find(c => c.id === id);
    return campo ? campo.nombre : id;
  }

  // Validar si hay campos válidos
  validarCamposMultiples(): boolean {
    return this.formEdicionMultiCampo.campos.some(c => c.campo && c.valor !== '');
  }

  // Ejecutar edición múltiple (SIMPLIFICADO - sin imágenes)
  // Ejecutar edición múltiple (MODIFICADO)
  async ejecutarEdicionMultiCampo() {
    try {
      // Validar
      if (!this.validarCamposMultiples()) {
        this.mostrarAlerta('Debes completar al menos un campo para actualizar', 'error');
        return;
      }

      // Si aplica a todos, obtener TODOS los IDs filtrados
      if (this.formEdicionMultiCampo.aplicarATodos) {
        this.loading = true;
        const todosLosIds = await this.obtenerTodosLosIdsFiltrados();

        if (todosLosIds.length === 0) {
          this.mostrarAlerta('No hay productos con los filtros actuales', 'warning');
          this.loading = false;
          return;
        }

        this.productosSeleccionados = new Set(todosLosIds);
        console.log(`✅ Se seleccionaron ${todosLosIds.length} productos para edición masiva`);
      }

      if (this.productosSeleccionados.size === 0) {
        this.mostrarAlerta('No hay productos seleccionados', 'error');
        return;
      }

      // Preparar updates combinando todos los campos
      const ids = Array.from(this.productosSeleccionados);
      const updates: any = {};

      // Procesar cada campo
      for (const item of this.formEdicionMultiCampo.campos) {
        if (item.campo && item.valor !== '') {
          let valor: any = item.valor;

          // Conversión de tipos
          if (item.campo === 'ubicacion_id') {
            valor = parseInt(valor);
          } else if (item.campo === 'cantidad_actual') {
            valor = parseInt(valor);
          } else if (item.campo === 'precio') {
            valor = parseFloat(valor);
          }

          updates[item.campo] = valor;
        }
      }

      // Si no hay updates válidos
      if (Object.keys(updates).length === 0) {
        this.mostrarAlerta('No hay campos válidos para actualizar', 'error');
        return;
      }

      this.loading = true;

      console.log(`🔄 Actualizando ${ids.length} productos con múltiples campos...`);
      console.log('📝 Campos:', updates);
      console.log('📋 IDs:', ids);

      const resultado = await this.productosService.actualizacionMasiva(
        ids,
        updates,
        this.formEdicionMultiCampo.motivo
      );

      this.mostrarAlerta(
        `✅ Actualizados ${resultado.actualizados} productos (${Object.keys(updates).length} campos)`,
        'success'
      );

      // Limpiar y cerrar
      this.productosSeleccionados.clear();
      this.cerrarEdicionMultiCampo();

      // Recargar
      await this.cargarProductos();
      await this.cargarEstadisticas();

    } catch (error: any) {
      console.error('❌ Error en edición múltiple:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }



  // ==================== MÉTODOS AUXILIARES PARA EDICIÓN MASIVA ====================

  // Método para obtener opciones de un campo específico
  getOpcionesCampo(campoId: string): any[] {
    if (!campoId) return [];

    const campo = this.camposEditables.find(c => c.id === campoId);
    return campo?.opciones || [];
  }

  // Método para obtener placeholder de un campo
  getPlaceholderCampo(campoId: string): string {
    if (!campoId) return '';

    const campo = this.camposEditables.find(c => c.id === campoId);
    return campo?.placeholder || '';
  }

  // Método para contar campos con valores válidos
  getCamposValidosCount(): number {
    if (!this.formEdicionMultiCampo.campos) return 0;

    return this.formEdicionMultiCampo.campos.filter(c => c.campo && c.valor !== '').length;
  }

  // Método para obtener campos con valores válidos
  getCamposValidos(): Array<{ campo: string, valor: any }> {
    if (!this.formEdicionMultiCampo.campos) return [];

    return this.formEdicionMultiCampo.campos.filter(c => c.campo && c.valor !== '');
  }







  // Toggle selección individual
  toggleSeleccionProducto(id: number) {
    if (this.productosSeleccionados.has(id)) {
      this.productosSeleccionados.delete(id);
    } else {
      this.productosSeleccionados.add(id);
    }
  }
  getOpcionesCampoSeleccionado(): any[] {
    if (!this.formEdicionMasiva.campo) {
      return [];
    }

    const campo = this.camposEditables.find(c => c.id === this.formEdicionMasiva.campo);

    if (!campo || !campo.opciones) {
      return [];
    }

    return campo.opciones;
  }
  // Seleccionar todos los productos visibles
  seleccionarTodos() {
    if (this.productosSeleccionados.size === this.productos.length) {
      // Si ya están todos seleccionados, deseleccionar
      this.productosSeleccionados.clear();
    } else {
      // Seleccionar todos los productos actuales
      this.productosSeleccionados = new Set(this.productos.map(p => p.id));
    }
  }

  // Verificar si un producto está seleccionado
  estaSeleccionado(id: number): boolean {
    return this.productosSeleccionados.has(id);
  }




  // Ejecutar edición masiva
  async ejecutarEdicionMasiva() {
    try {
      if (!this.formEdicionMasiva.campo || this.formEdicionMasiva.valor === '') {
        this.mostrarAlerta('Selecciona un campo y valor para actualizar', 'error');
        return;
      }

      if (this.formEdicionMasiva.aplicarATodos) {
        // Si aplica a todos, usar todos los productos filtrados
        this.productosSeleccionados = new Set(this.productos.map(p => p.id));
      }

      if (this.productosSeleccionados.size === 0) {
        this.mostrarAlerta('No hay productos seleccionados', 'error');
        return;
      }

      // Preparar datos para actualización
      const ids = Array.from(this.productosSeleccionados);
      const campo = this.formEdicionMasiva.campo;
      let valor: any = this.formEdicionMasiva.valor;

      // Convertir tipos de datos
      if (campo === 'ubicacion_id') {
        valor = parseInt(valor);
      } else if (campo === 'precio') {
        valor = parseFloat(valor);
      }

      // Crear objeto con el campo a actualizar
      const updates: any = {};
      updates[campo] = valor;

      this.loading = true;

      console.log(`🔄 Actualizando ${ids.length} productos...`);
      console.log('📝 Campo:', campo);
      console.log('🎯 Valor:', valor);
      console.log('📋 IDs:', ids);

      const resultado = await this.productosService.actualizacionMasiva(
        ids,
        updates,
        this.formEdicionMasiva.motivo
      );

      this.mostrarAlerta(
        `✅ Actualizados ${resultado.actualizados} productos exitosamente`,
        'success'
      );

      // Limpiar selección y cerrar modal
      this.productosSeleccionados.clear();

      // Recargar datos
      await this.cargarProductos();
      await this.cargarEstadisticas();

    } catch (error: any) {
      console.error('❌ Error en edición masiva:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }
  // En tu componente, agrega estos métodos:

  // Método para manejar el cambio en "Aplicar a todos"
  onAplicarATodosChange() {
    console.log('🔘 Checkbox cambiar:', this.formEdicionMultiCampo.aplicarATodos);

    if (this.formEdicionMultiCampo.aplicarATodos) {
      // Cuando se activa "Aplicar a todos", limpiar selección manual
      this.productosSeleccionados.clear();
      this.mostrarAlerta(
        `Se aplicarán cambios a todos los productos filtrados (${this.totalProductos} productos)`,
        'warning' // o 'success' si prefieres
      );
    }
  }

  // Método para obtener todos los IDs de productos filtrados
  async obtenerTodosLosIdsFiltrados(): Promise<number[]> {
    try {
      console.log('🔍 Obteniendo todos los IDs de productos filtrados...');

      // Crear filtros sin paginación para obtener todos los productos
      const filtrosCompletos = {
        ...this.filtros,
        limit: 10000, // Un número grande para obtener todos
        page: 1
      };

      const resultado = await this.productosService.getProductos(filtrosCompletos);
      const todosLosIds = resultado.data.map((producto: any) => producto.id);

      console.log(`📋 Se encontraron ${todosLosIds.length} productos con los filtros actuales`);
      return todosLosIds;

    } catch (error: any) {
      console.error('❌ Error obteniendo todos los IDs:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
      return [];
    }
  }


  // Obtener texto para botón de selección (versión multicampo)
  getTextoSeleccionMultiCampo(): string {
    if (this.formEdicionMultiCampo.aplicarATodos) {
      return `Editar todos (${this.totalProductos})`;
    }

    const count = this.productosSeleccionados.size;
    if (count === 0) return 'Seleccionar para edición masiva';
    return `Editar ${count} seleccionado${count !== 1 ? 's' : ''}`;
  }




  // Alerta
  alerta = {
    mostrar: false,
    tipo: 'success' as 'success' | 'error' | 'warning',
    mensaje: '',
    autoCerrar: true
  };

  // Referencias
  @ViewChild('searchInput') searchInput!: ElementRef;

  constructor(
    private productosService: ProductosService,
    private trazabilidadService: TrazabilidadService,
    private ubicacionesService: UbicacionesService,
        private usuariosService: UsuariosService,
            private authService: AuthService,
    private cdRef: ChangeDetectorRef
  ) { }

  async ngOnInit() {
    await this.cargarUsuarioActual();
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

  async cargarDatosIniciales() {
    try {
      this.loading = true;

      // Primero cargar productos y ubicaciones
      await Promise.all([
        this.cargarProductos(),
        this.cargarUbicaciones()
      ]);

      // Ahora cargar estadísticas (que necesita los productos ya cargados)
      await this.cargarEstadisticas();

    } catch (error) {
      this.mostrarAlerta('Error al cargar datos iniciales', 'error');
    } finally {
      this.loading = false;
    }
  }
  async cargarProductos() {
    try {
      this.loadingProductos = true;
      const resultado = await this.productosService.getProductos(this.filtros);

      this.productos = resultado.data;
      this.totalProductos = resultado.count;
      this.totalPaginas = Math.ceil(this.totalProductos / this.filtros.limit);
      this.generarPaginas();

    } catch (error: any) {
      this.mostrarAlerta(`Error al cargar productos: ${error.message}`, 'error');
    } finally {
      this.loadingProductos = false;
    }
  }

  async cargarEstadisticas() {
    try {
      // Obtener las estadísticas básicas del servicio
      const statsBasicas = await this.productosService.getEstadisticas();
      this.estadisticas = {
        total: statsBasicas.total,
        activos: statsBasicas.activos,
        bajoStock: statsBasicas.bajoStock,
        agotados: statsBasicas.agotados,
        valorTotal: statsBasicas.valorTotal,
        criticos: statsBasicas.criticos ?? 0
      };

      // Calcular estadísticas por estado
      this.calcularEstadisticasPorEstado();

    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    }
  }

  async cargarUbicaciones() {
    try {
      this.ubicaciones = await this.ubicacionesService.getUbicacionesActivas();

      // Actualizar las opciones del campo ubicacion_id en camposEditables
      const ubicacionCampo = this.camposEditables.find(c => c.id === 'ubicacion_id');
      if (ubicacionCampo) {
        ubicacionCampo.opciones = this.ubicaciones.map(u => ({
          value: u.id,
          label: u.nombre
        }));
      }

    } catch (error) {
      console.error('Error cargando ubicaciones:', error);
    }
  }
  async cargarMovimientosProducto(productoId: number) {
    try {
      this.loadingMovimientos = true;
      const historial = await this.trazabilidadService.getHistorialProducto(productoId, 50);
      this.movimientosProducto = historial;
    } catch (error: any) {
      this.mostrarAlerta(`Error al cargar movimientos: ${error.message}`, 'error');
    } finally {
      this.loadingMovimientos = false;
    }
  }

  async exportarExcel() {
    try {
      this.loading = true;

      const filtrosExportacion = {
        search: this.filtros.search,
        estado: this.filtros.estado !== 'todos' ? this.filtros.estado : undefined,
        criticidad: this.filtros.criticidad !== 'todos' ? this.filtros.criticidad : undefined,
        ubicacion_id: this.filtros.ubicacion_id || undefined,
        componente: this.filtros.componente !== 'todos' ? this.filtros.componente : undefined, // ← NUEVO
        bajo_stock: this.filtros.bajo_stock || undefined
      };

      console.log('📤 Exportando inventario a Excel con filtros:', filtrosExportacion);

      await this.productosService.exportarProductosAExcel(filtrosExportacion);

      console.log('✅ Inventario exportado exitosamente');

    } catch (error: any) {
      console.error('❌ Error exportando Excel:', error);
      this.mostrarAlerta(`Error al exportar: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }
  // Método para validar automáticamente la cantidad
  validarCantidad() {
    if (!this.productoSeleccionado || this.productoEsSeriado) return;

    // Si el producto no es seriado
    if (this.formMovimiento.cantidad <= 0) {
      this.formMovimiento.cantidad = 1;
    }

    // Si la cantidad excede el stock disponible
    if (this.formMovimiento.cantidad > this.productoSeleccionado.cantidad_actual) {
      // Opcional: mostrar alerta inmediata
      this.mostrarAlerta(
        `La cantidad no puede exceder el stock disponible (${this.productoSeleccionado.cantidad_actual})`,
        'warning'
      );

      // Opcional: auto-corregir al máximo disponible
      // this.formMovimiento.cantidad = this.productoSeleccionado.cantidad_actual;
    }
  }
  // ==================== FILTROS Y BÚSQUEDA ====================

  buscarProductos() {
    this.filtros.page = 1;
    this.cargarProductos();
  }

  limpiarFiltros() {
    this.filtros = {
      search: '',
      estado: 'todos',
      criticidad: 'todos',
      ubicacion_id: 0,
      componente: 'todos',     // ← NUEVA LÍNEA
      bajo_stock: false,
      page: 1,
      limit: 20,
      orderBy: 'id',
      orderDir: 'desc'
    };
    this.cargarProductos();
  }
  // Agrega este método a tu componente
  getEstadoClase(estado: string): string {
    if (!estado) return '';

    // Convertir a formato válido para CSS:
    // 1. Convertir a mayúsculas
    // 2. Reemplazar espacios por guiones
    // 3. Eliminar paréntesis y caracteres especiales
    // 4. Reemplazar acentos
    let clase = estado.toUpperCase()
      .replace(/Á/g, 'A')
      .replace(/É/g, 'E')
      .replace(/Í/g, 'I')
      .replace(/Ó/g, 'O')
      .replace(/Ú/g, 'U')
      .replace(/Ñ/g, 'N')
      .replace(/\s+/g, '-')
      .replace(/[\(\)]/g, '')
      .replace(/[^A-Z0-9\-]/g, '')
      .replace(/\-+/g, '-')
      .trim();

    return `inventario-badge inventario-badge-estado-${clase}`;
  }

  // Método para obtener el texto del estado (opcional, para mantener el texto original)
  getEstadoTexto(estado: string): string {
    if (!estado) return '-';
    // Puedes convertir la primera letra de cada palabra a mayúscula
    return estado.replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }
  cambiarOrden(columna: string) {
    if (this.filtros.orderBy === columna) {
      this.filtros.orderDir = this.filtros.orderDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.filtros.orderBy = columna;
      this.filtros.orderDir = 'asc';
    }
    this.cargarProductos();
  }

  // ==================== PAGINACIÓN ====================

  generarPaginas() {
    const paginas = [];
    const inicio = Math.max(1, this.filtros.page - 2);
    const fin = Math.min(this.totalPaginas, this.filtros.page + 2);

    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }
    this.paginas = paginas;
  }

  cambiarPagina(pagina: number) {
    if (pagina >= 1 && pagina <= this.totalPaginas) {
      this.filtros.page = pagina;
      this.cargarProductos();
    }
  }

  // ==================== CRUD PRODUCTOS ====================

  mostrarFormularioCrear() {
    // Ocultar paginación al abrir formulario
    this.showPagination = false;

    this.modoFormulario = 'crear';
    this.resetFormulario();
    this.vistaActual = 'formulario';

    // Si es repuesto seriado, establecer cantidad en 1
    if (this.esRepuestoSeriado) {
      this.formProducto.cantidad_actual = 1;
    }

    // Prevenir scroll del body
    document.body.style.overflow = 'hidden';
  }
  mostrarFormularioEditar(producto: any) {
    // Ocultar paginación al abrir formulario
    this.showPagination = false;

    this.modoFormulario = 'editar';
    this.formProducto = {
      id: producto.id,
      nombre: producto.nombre,
      descripcion: producto.descripcion || '',
      componente: producto.componente || '',
      criticidad: producto.criticidad,
      part_number: producto.part_number || '',
      codigo: producto.codigo || '',
      serial_number: producto.serial_number || '',
      estado: producto.estado,
      cantidad_actual: producto.cantidad_actual || 1, // Usar 1 si es null/undefined
      ubicacion_id: producto.ubicacion_id,
      estanteria: producto.estanteria || '',
      precio: producto.precio,
      fecha_adquisicion: producto.fecha_adquisicion || '',
      orden_envio: producto.orden_envio || '',
      factura: producto.factura || '',
      observaciones: producto.observaciones || ''
    };

    // Si el producto tiene part_number, marcarlo como repuesto seriado
    this.esRepuestoSeriado = !!producto.serial_number;

    // Si es seriado, asegurar que la cantidad sea 1
    if (this.esRepuestoSeriado && this.formProducto.cantidad_actual !== 1) {
      this.formProducto.cantidad_actual = 1;
    }

    this.vistaActual = 'formulario';

    // Prevenir scroll del body
    document.body.style.overflow = 'hidden';
  }
  async guardarProducto() {
    // ============ VALIDACIONES GENERALES ============


    // 1. Validar Part Number (obligatorio para todos)
    if (!this.formProducto.part_number?.trim()) {
      this.mostrarAlerta('El Part Number es obligatorio', 'error');
      return;
    }

    // 2. Validar estantería para BODEGA QUITO (id=9)
    if (this.formProducto.ubicacion_id === 9 && !this.formProducto.estanteria?.trim()) {
      this.mostrarAlerta('La estantería es obligatoria para BODEGA QUITO', 'error');
      return;
    }

    // 3. Validaciones específicas para productos no seriados
    if (!this.formProducto.codigo?.trim()) {
      this.mostrarAlerta('El código es obligatorio', 'error');
      return;
    }

    // 3. Validaciones específicas para repuestos seriados
    if (this.esRepuestoSeriado) {
      // Validar Serial Number (obligatorio para seriados)
      if (!this.formProducto.serial_number?.trim()) {
        this.mostrarAlerta('El Serial Number es obligatorio para repuestos seriados', 'error');
        return;
      }

      // Validar Part Number (obligatorio para seriados)
      if (!this.formProducto.part_number?.trim()) {
        this.mostrarAlerta('El Part Number es obligatorio para repuestos seriados', 'error');
        return;
      }

      // Forzar cantidad = 1 para seriados
      this.formProducto.cantidad_actual = 1;

      // Verificar si ya existe un producto con el mismo serial number
      try {
        const productosConMismoSerial = await this.productosService.buscarProductos(this.formProducto.serial_number);
        const productoDuplicado = productosConMismoSerial.find(p =>
          p.serial_number?.toLowerCase() === this.formProducto.serial_number.toLowerCase() &&
          p.id !== this.formProducto.id
        );

        if (productoDuplicado) {
          this.mostrarAlerta(
            `Ya existe un producto con el Serial Number "${this.formProducto.serial_number}". 
          Los Serial Numbers deben ser únicos.`,
            'error'
          );
          return;
        }
      } catch (error) {
        console.warn('Error verificando serial duplicado:', error);
      }
    }

    // ============ CONTINUAR CON EL RESTO DEL CÓDIGO ============
    try {
      this.loading = true;

      let productoGuardado;

      if (this.modoFormulario === 'crear') {
        // Crear producto sin imágenes primero
        productoGuardado = await this.productosService.createProducto(this.formProducto);
        this.formProducto.id = productoGuardado.id;
      }

      // Manejar imágenes primero - esto es CRÍTICO
      let ordenEnvioActualizada = false;
      let facturaActualizada = false;

      // Subir nueva orden de envío si hay archivo
      if (this.ordenEnvioFile) {
        console.log('📤 Subiendo NUEVA orden de envío');
        await this.productosService.uploadOrdenEnvio(
          this.formProducto.id,
          this.ordenEnvioFile
        );
        ordenEnvioActualizada = true;
      }

      // Subir nueva factura si hay archivo
      if (this.facturaFile) {
        console.log('📤 Subiendo NUEVA factura');
        await this.productosService.uploadFactura(
          this.formProducto.id,
          this.facturaFile
        );
        facturaActualizada = true;
      }

      // Si es edición, actualizar producto pero NO sobreescribir imágenes recién subidas
      if (this.modoFormulario === 'editar') {
        // Crear copia del formProducto sin las imágenes que ya fueron actualizadas
        const updates: any = { ...this.formProducto };

        // Si se subió nueva orden_envio, NO incluirla en updates (ya se actualizó)
        if (ordenEnvioActualizada) {
          delete updates.orden_envio;
        }

        // Si se subió nueva factura, NO incluirla en updates (ya se actualizó)
        if (facturaActualizada) {
          delete updates.factura;
        }

        // Eliminar propiedades que no necesitan actualizarse
        delete updates.id;
        delete updates.created_at;

        console.log('📝 Actualizando producto con:', updates);

        await this.productosService.updateProducto(this.formProducto.id, updates);
      }

      this.mostrarAlerta('Producto guardado exitosamente', 'success');

      // Limpiar previsualizaciones y archivos
      this.ordenEnvioPreview = null;
      this.facturaPreview = null;
      this.ordenEnvioFile = null;
      this.facturaFile = null;

      // ********* AQUÍ ESTÁ LA PARTE QUE CIERRA EL FORMULARIO *********
      this.showPagination = true;  // Mostrar paginación nuevamente
      this.vistaActual = 'lista';  // Cambiar a vista de lista - ¡ESTO CIERRA EL MODAL!

      // Restaurar scroll del body
      document.body.style.overflow = '';

      // Recargar productos
      await this.cargarProductos();
      await this.cargarEstadisticas();
      //await this.productosService.verificarSTOCKbAJOYACTUALIZARBASE();

    } catch (error: any) {
      console.error('❌ Error en guardarProducto:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }
  // Métodos para eliminar imágenes existentes
  async eliminarOrdenEnvio() {
    if (!this.formProducto.orden_envio) return;

    if (confirm('¿Está seguro de eliminar la orden de envío?')) {
      try {
        await this.productosService.deleteOrdenEnvio(this.formProducto.id);
        this.formProducto.orden_envio = '';
        this.mostrarAlerta('Orden de envío eliminada', 'success');
      } catch (error: any) {
        this.mostrarAlerta(`Error: ${error.message}`, 'error');
      }
    }
  }

  async eliminarFactura() {
    if (!this.formProducto.factura) return;

    if (confirm('¿Está seguro de eliminar la factura?')) {
      try {
        await this.productosService.deleteFactura(this.formProducto.id);
        this.formProducto.factura = '';
        this.mostrarAlerta('Factura eliminada', 'success');
      } catch (error: any) {
        this.mostrarAlerta(`Error: ${error.message}`, 'error');
      }
    }
  }

  async eliminarProducto(producto: any) {
    if (producto.estado?.toUpperCase() !== 'CONDENADO') {
      this.mostrarAlerta(
        `El producto no está en estado CONDENADO (estado actual: ${producto.estado || 'sin estado'}). No se puede eliminar.`,
        'warning'
      );
      return;
    }
    if (!confirm(`¿Está seguro de eliminar el producto "${producto.nombre}"?`)) return;

    try {
      this.loading = true;
      const resultado = await this.eliminarUnProductoConVerificacion(producto);
      this.mostrarAlerta(
        `✅ Producto eliminado definitivamente. ${resultado.alertaEnviada ? 'Alerta enviada.' : ''}`,
        'success'
      );
      // Recargar datos
      await this.cargarProductos();
      await this.cargarEstadisticas();
    } catch (error: any) {
      this.mostrarAlerta(error.message || 'Error al eliminar producto', 'error');
    } finally {
      this.loading = false;
    }
  }
  private async eliminarUnProductoConVerificacion(producto: any): Promise<{ eliminado: boolean, alertaEnviada: boolean }> {
    try {
      // Guardar datos necesarios antes de eliminar
      const esSeriado = !!producto.serial_number;
      let stockAntes = 0;
      let umbral = 5;

      if (esSeriado && producto.part_number) {
        const productosAntes = await this.productosService.getProductosPorPartNumber(producto.part_number);
        stockAntes = productosAntes.reduce((sum, p) => sum + (p.cantidad_actual || 1), 0);
        umbral = await this.productosService.obtenerUmbralStockMinimo();
      }

      // Ejecutar eliminación
      await this.productosService.eliminarProductoPermanente(producto.id);

      let alertaEnviada = false;
      // Verificar después
      if (esSeriado && producto.part_number) {
        const productosDespues = await this.productosService.getProductosPorPartNumber(
          producto.part_number,
          producto.id
        );
        const stockDespues = productosDespues.reduce((sum, p) => sum + (p.cantidad_actual || 1), 0);

        const estabaEnStockBajo = stockAntes <= umbral;
        const ahoraEnStockBajo = stockDespues <= umbral;

        if (!estabaEnStockBajo && ahoraEnStockBajo) {
          let productoParaAlerta;

          // Obtener el producto agrupado (con stock total y seriales)
          const agrupado = await this.productosService.getProductoAgrupadoPorPartNumber(producto.part_number);
          if (agrupado) {
            // 🔁 Aseguramos que serial_number contenga la lista concatenada
            productoParaAlerta = { ...agrupado, serial_number: agrupado.serial_numbers };
          } else if (productosDespues.length > 0) {
            productoParaAlerta = productosDespues[0];
          } else {
            productoParaAlerta = { ...producto, cantidad_actual: 0 };
          }

          await this.productosService.enviarAlertaProductoIndividual(productoParaAlerta);
          alertaEnviada = true;
        }
      }

      return { eliminado: true, alertaEnviada };
    } catch (error) {
      console.error('Error eliminando producto individual:', error);
      throw error;
    }
  }
  resetFormulario() {
    // Obtener fecha actual en formato YYYY-MM-DD
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];

    this.formProducto = {
      id: 0,
      nombre: '',
      descripcion: '',
      componente: 'RA',
      criticidad: 'MEDIA',
      part_number: '',
      codigo: '',
      serial_number: '',
      estado: 'NUEVO',
      cantidad_actual: 1, // ¡SIEMPRE inicializar en 1!
      ubicacion_id: 9,
      estanteria: '',
      precio: 0,
      fecha_adquisicion: formattedDate,
      orden_envio: '',
      factura: '',
      observaciones: ''
    };

    // Limpiar archivos seleccionados
    this.ordenEnvioFile = null;
    this.facturaFile = null;
    this.ordenEnvioPreview = null;
    this.facturaPreview = null;

    // Limpiar campos de repuesto seriado
    this.partNumberBuscar = '';
    this.productosEncontrados = [];
    this.productoSeleccionadoExistente = null;
    this.buscandoProducto = false;
    this.busquedaRealizada = false;
    this.clonandoDeProductoExistente = false;
  }
  // ==================== MÉTODOS PARA MOVIMIENTOS (NUEVOS) ====================

  seleccionarProducto(producto: any) {
    // Ocultar paginación al abrir detalle
    this.showPagination = false;

    this.productoSeleccionado = producto;
    this.resetFormularioMovimiento();
    this.vistaActual = 'detalle';

    // Determinar si el producto es seriado (tiene part_number)
    this.productoEsSeriado = !!producto.serial_number;

    // Si el producto es seriado, establecer cantidad en 1 y bloquear
    if (this.productoEsSeriado) {
      this.formMovimiento.cantidad = 1;
    }

    // Establecer la ubicación origen actual del producto
    if (producto.ubicacion_nombre) {
      this.formMovimiento.ubicacion_origen = producto.ubicacion_nombre;
    }

    // QUITAR la restricción que forzaba BODEGA QUITO como destino
    // Ahora el usuario puede elegir cualquier ubicación

    // Prevenir scroll del body
    document.body.style.overflow = 'hidden';
  }
  // Método para resetear el formulario de movimiento
  resetFormularioMovimiento() {
    this.formMovimiento = {
      tipo_evento: 'transferencia',
      producto_id: this.productoSeleccionado?.id || 0,
      cantidad: 1,
      estado_evento: 'completado',
      motivo: 'S.M',
      ubicacion_origen: '',
      ubicacion_destino: '',
      estanteria: '', // <-- AÑADIDO AQUÍ
      detalles: '',
      observaciones: ''
    };
    this.productoEsSeriado = false;
  }

  // NUEVO: Método para obtener ubicación por nombre
  // NUEVO: Método para obtener ubicación por nombre
  getUbicacionIdPorNombre(nombre: string | null): number | null {
    if (!nombre) return null;
    const ubicacion = this.ubicaciones.find(u => u.nombre === nombre);
    return ubicacion ? ubicacion.id : null;
  }

  // Método mejorado para buscar productos en BODEGA QUITO
  async buscarProductoEnBodegaQuito(codigo: string): Promise<any> {
    try {
      if (!codigo || codigo.trim() === '') {
        console.log('⚠️ No hay código para buscar');
        return null;
      }

      console.log(`🔍 Buscando producto con código: "${codigo}" en BODEGA QUITO`);

      // Usar filtros más específicos
      const filtros = {
        search: codigo,
        limit: 50,
        page: 1,
        ubicacion_id: 9 // Filtrar solo por BODEGA QUITO
      };

      const resultado = await this.productosService.getProductos(filtros);

      // Buscar coincidencia exacta del código y que esté activo
      const productoEnBodega = resultado.data.find((p: any) =>
        p.codigo === codigo &&
        p.ubicacion_id === 9 &&
        p.esta_activo === true
      );

      if (productoEnBodega) {
        console.log(`✅ Producto encontrado en BODEGA QUITO: ID ${productoEnBodega.id}, Stock: ${productoEnBodega.cantidad_actual}`);
      } else {
        console.log(`❌ No se encontró producto con código "${codigo}" en BODEGA QUITO`);
      }

      return productoEnBodega || null;
    } catch (error) {
      console.error('Error en búsqueda:', error);
      return null;
    }
  }

  // Método para validar las ubicaciones según el tipo
  validarUbicaciones(): boolean {
    const tipo = this.formMovimiento.tipo_evento;

    switch (tipo) {
      case 'entrada':
      case 'devolucion':
        // Requiere destino, origen es opcional
        return !!this.formMovimiento.ubicacion_destino;

      case 'salida':
      case 'consumo':
        // Requiere origen, destino es opcional
        return !!this.formMovimiento.ubicacion_origen;

      case 'transferencia':
        // Requiere ambos
        return !!this.formMovimiento.ubicacion_origen &&
          !!this.formMovimiento.ubicacion_destino;

      case 'ajuste':
        // Al menos uno de los dos
        return !!this.formMovimiento.ubicacion_origen ||
          !!this.formMovimiento.ubicacion_destino;

      default:
        return true; // Para otros tipos, no requiere validación
    }
  }

  // Método para obtener nombre de ubicación

  onTipoEventoChange() {
    // Opcional: resetear ubicaciones cuando cambia el tipo
    if (this.formMovimiento.tipo_evento === 'transferencia') {
      this.formMovimiento.ubicacion_origen = null;
    } else if (this.formMovimiento.tipo_evento === 'salida') {
      this.formMovimiento.ubicacion_destino = null;
    }
    // Para otros tipos, mantén los valores o resetea según necesites
  }










  // Método para ejecutar movimiento (NUEVO - usando el formulario completo)
  // Método para ejecutar movimiento - VERSIÓN CORREGIDA
  // En el componente Inventario - método ejecutarMovimiento() actualizado

  async ejecutarMovimiento() {
    if (!this.productoSeleccionado && !this.formMovimiento.producto_id) {
      this.mostrarAlerta('Debe seleccionar un producto', 'error');
      return;
    }

    if (!this.formMovimiento.motivo.trim()) {
      this.mostrarAlerta('El motivo es requerida', 'error');
      return;
    }
    // ===== NUEVA VALIDACIÓN: Estantería para BODEGA QUITO =====
    if (this.esDestinoBodegaQuito() && !this.formMovimiento.estanteria?.trim()) {
      this.mostrarAlerta('La estantería es obligatoria para BODEGA QUITO', 'error');
      return;
    }

    // ===== VALIDACIÓN DE CANTIDAD PARA PRODUCTOS NO SERIADOS =====
    if (!this.productoEsSeriado) {
      if (this.formMovimiento.cantidad <= 0) {
        this.mostrarAlerta('La cantidad debe ser mayor a 0', 'error');
        return;
      }

      // Aquí está la validación CRÍTICA que necesitas
      if (this.formMovimiento.cantidad > this.productoSeleccionado.cantidad_actual) {
        this.mostrarAlerta(
          `La cantidad (${this.formMovimiento.cantidad}) excede el stock disponible (${this.productoSeleccionado.cantidad_actual})`,
          'error'
        );
        return;
      }

      // Validación adicional: si el stock es 0, no se puede realizar movimiento
      if (this.productoSeleccionado.cantidad_actual === 0) {
        this.mostrarAlerta(
          'No se puede realizar movimiento porque el producto tiene stock 0',
          'error'
        );
        return;
      }
    }
    this.cantidadAnterior = this.productoSeleccionado.cantidad_actual;
    // Validación para productos seriados
    if (this.productoEsSeriado) {
      if (this.formMovimiento.cantidad !== 1) {
        this.formMovimiento.cantidad = 1;
      }


      console.log(`🚨 xxxxxxxxxxxxxxxxxx: ${this.formMovimiento.producto_id}`);
      this.cantidadAnterior = await this.productosService.obtenerCantidadSeriadoPorId(this.formMovimiento.producto_id);

    }

    try {
      this.loading = true;

      // GUARDAR LA CANTIDAD ANTERIOR ANTES DEL MOVIMIENTO

      const productoId = this.productoSeleccionado.id;

      // ESCENARIO 1: Producto seriado
      if (this.productoEsSeriado) {
        await this.manejarMovimientoSeriado();
      }
      // ESCENARIO 2: Producto NO seriado - UNIFICADO
      else {
        await this.manejarMovimientoNoSeriado();
      }

      this.mostrarAlerta('Movimiento registrado exitosamente', 'success');
// Enviar reporte por correo (no bloqueante)
const detalleMovimiento = {
  tipo: this.productoEsSeriado ? 'Movimiento individual (seriado)' : 'Movimiento individual (no seriado)',
  motivo: this.formMovimiento.motivo,
  observaciones: this.formMovimiento.observaciones,
  usuario: 'Usuario actual', // Opcional: obtener de localStorage o servicio de auth
  productos: [{
    id: this.productoSeleccionado.id,
    nombre: this.productoSeleccionado.nombre,
    codigo: this.productoSeleccionado.codigo,
    part_number: this.productoSeleccionado.part_number,
    serial_number: this.productoSeleccionado.serial_number,
    cantidad: this.formMovimiento.cantidad,
    ubicacion_origen: this.formMovimiento.ubicacion_origen || this.productoSeleccionado.ubicacion_nombre,
    ubicacion_destino: this.formMovimiento.ubicacion_destino
  }]
};

this.productosService.enviarReporteMovimiento(detalleMovimiento).catch(err => 
  console.error('Error enviando reporte de movimiento individual:', err)
);
      // Volver a la lista y restaurar paginación
      this.volver();

      // Recargar datos
      await this.cargarProductos();
      await this.cargarEstadisticas();

      // ************** NUEVA LÓGICA SIMPLE **************
      // Solo verificar si ESTE producto específico pasó a stock bajo
      const resultado = await this.productosService.verificarProductoStockBajo(
        productoId,
        this.cantidadAnterior
      );
      if (resultado.bajoStock && resultado.producto) {
        console.log(`🚨 Enviando alerta para producto ID: ${productoId}`);

        let productoParaAlerta = resultado.producto;

        // Si es seriado, obtener el producto agrupado (con stock total y seriales)
        if (resultado.producto.serial_number && resultado.producto.part_number) {
          const agrupado = await this.productosService.getProductoAgrupadoPorPartNumber(
            resultado.producto.part_number
          );
          if (agrupado) {
            // Copiamos los seriales concatenados al campo 'serial_number'
            productoParaAlerta = { ...agrupado, serial_number: agrupado.serial_numbers };
          }
        }

        const exito = await this.productosService.enviarAlertaProductoIndividual(productoParaAlerta);

        if (exito) {
          this.mostrarAlerta(
            `✅ Alerta enviada: "${productoParaAlerta.nombre}" (stock total: ${productoParaAlerta.cantidad_actual}) pasó a stock bajo`,
            'success'
          );
        }
      } else {
        console.log(`✅ Producto ${productoId} no pasó a stock bajo, no se envía alerta`);
      }
      // ************** FIN NUEVA LÓGICA **************

    } catch (error: any) {
      console.error('❌ Error registrando movimiento:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
    } finally {
      this.loading = false;
    }
  }
















  // En el método manejarMovimientoNoSeriado():
  async manejarMovimientoNoSeriado(): Promise<number> { // ← Retorna el ID del producto actualizado
    console.log('🔄 Procesando movimiento de producto NO SERIADO');

    const ubicacionDestinoId = this.getUbicacionIdPorNombre(this.formMovimiento.ubicacion_destino);

    if (!ubicacionDestinoId) {
      throw new Error('Ubicación destino no válida');
    }

    // 1. Buscar si ya existe un producto con el mismo código en la ubicación destino
    let productoEnDestino = null;
    if (this.productoSeleccionado.codigo) {
      productoEnDestino = await this.buscarProductoPorCodigoYUbicacion(
        this.productoSeleccionado.codigo,
        ubicacionDestinoId
      );
    }

    // 2. Calcular nueva cantidad para el producto original
    const nuevaCantidadOriginal = this.productoSeleccionado.cantidad_actual - this.formMovimiento.cantidad;

    // 3. Manejar el producto original
    let productoIdParaVerificar = this.productoSeleccionado.id;

    if (nuevaCantidadOriginal > 0) {
      // CASO A: Cantidad parcial - Actualizar cantidad del producto original
      // NO MODIFICAR ESTANTERÍA - dejar como está
      await this.productosService.updateProducto(this.productoSeleccionado.id, {
        cantidad_actual: nuevaCantidadOriginal
        // NO tocar estanteria aquí
      });
    } else {
      // CASO B: Cantidad total (nuevaCantidadOriginal <= 0)
      const productoOriginal = await this.productosService.getProductoById(this.productoSeleccionado.id);

      if (productoOriginal.ubicacion_id === 9) {
        // Si está en BODEGA QUITO, actualizar a 0
        // NO MODIFICAR ESTANTERÍA - dejar como está
        await this.productosService.updateProducto(this.productoSeleccionado.id, {
          cantidad_actual: 0
          // NO tocar estanteria aquí
        });
      } else {
        // Si NO está en BODEGA QUITO, desactivar
        await this.productosService.desactivarProducto(
          this.productoSeleccionado.id,
          `Producto movido completamente a ${this.formMovimiento.ubicacion_destino}`
        );
        productoIdParaVerificar = null;
      }
    }

    // 4. Manejar el producto en la ubicación destino
    if (productoEnDestino) {
      // CASO A: Producto existe en destino - Sumar la cantidad
      const nuevaCantidadDestino = productoEnDestino.cantidad_actual + this.formMovimiento.cantidad;

      const updateDestino: any = {
        cantidad_actual: nuevaCantidadDestino
      };

      // Si el destino es BODEGA QUITO, actualizar la estantería
      if (ubicacionDestinoId === 9 && this.formMovimiento.estanteria) {
        updateDestino.estanteria = this.formMovimiento.estanteria;
      }

      await this.productosService.updateProducto(productoEnDestino.id, updateDestino);

      // Si el producto original fue desactivado, verificamos el producto en destino
      if (!productoIdParaVerificar) {
        productoIdParaVerificar = productoEnDestino.id;
      }
    } else {
      // CASO B: Producto NO existe en destino - Crear nuevo producto
      const nuevoProducto = {
        nombre: this.productoSeleccionado.nombre,
        descripcion: this.productoSeleccionado.descripcion,
        componente: this.productoSeleccionado.componente,
        criticidad: this.productoSeleccionado.criticidad,
        part_number: this.productoSeleccionado.part_number,
        codigo: this.productoSeleccionado.codigo,
        serial_number: '',
        estado: this.productoSeleccionado.estado,
        cantidad_actual: this.formMovimiento.cantidad,
        ubicacion_id: ubicacionDestinoId,

        // IMPORTANTE: Solo asignar estantería si el destino es BODEGA QUITO
        estanteria: ubicacionDestinoId === 9 ? this.formMovimiento.estanteria : '',

        precio: this.productoSeleccionado.precio,
        fecha_adquisicion: new Date().toISOString().split('T')[0],
        orden_envio: null,
        factura: null,
        observaciones: `Creado por movimiento desde producto ID: ${this.productoSeleccionado.id}`
      };

      const productoNuevo = await this.productosService.createProducto(nuevoProducto);

      // Si el producto original fue desactivado, verificamos el nuevo producto
      if (!productoIdParaVerificar) {
        productoIdParaVerificar = productoNuevo.id;
      }
    }

    // 5. Registrar movimiento
    const movimientoData = {
      tipo_evento: this.formMovimiento.tipo_evento,
      producto_id: this.productoSeleccionado.id,
      cantidad: this.formMovimiento.cantidad,
      estado_evento: this.formMovimiento.estado_evento,
      motivo: this.formMovimiento.motivo,
      ubicacion_origen: this.formMovimiento.ubicacion_origen || this.productoSeleccionado.ubicacion_nombre,
      ubicacion_destino: this.formMovimiento.ubicacion_destino,
      detalles: this.formMovimiento.detalles,
      observaciones: this.formMovimiento.observaciones
    };

    await this.trazabilidadService.registrarMovimiento(movimientoData);

    console.log('✅ Producto NO seriado movido a nueva ubicación con estantería actualizada');

    return productoIdParaVerificar || this.productoSeleccionado.id;
  }

  manejarClickBoton() {
    console.log('Botón clickeado');

    // Verificar si debería estar "deshabilitado" - AÑADE la validación de estantería
    const estaDeshabilitado = this.loading ||
      !this.formMovimiento.motivo ||
      this.formMovimiento.cantidad <= 0 ||
      (!this.productoEsSeriado && this.formMovimiento.cantidad > this.productoSeleccionado?.cantidad_actual) ||
      !this.formMovimiento.ubicacion_destino ||
      (this.esDestinoBodegaQuito() && !this.formMovimiento.estanteria?.trim()); // <-- NUEVA CONDICIÓN

    if (estaDeshabilitado) {
      console.log('Mostrando mensaje de campos faltantes');

      // Mostrar mensaje específico
      let mensaje = 'Complete los siguientes campos:\n';

      if (!this.formMovimiento.motivo) {
        mensaje += '• Motivo\n';
      }

      if (this.formMovimiento.cantidad <= 0) {
        mensaje += '• Cantidad mayor a 0\n';
      }

      if (!this.productoEsSeriado && this.formMovimiento.cantidad > this.productoSeleccionado?.cantidad_actual) {
        mensaje += `• Cantidad no exceda stock (${this.productoSeleccionado?.cantidad_actual})\n`;
      }

      if (!this.formMovimiento.ubicacion_destino) {
        mensaje += '• Ubicación destino\n';
      }

      // NUEVO: Mensaje para estantería
      if (this.esDestinoBodegaQuito() && !this.formMovimiento.estanteria?.trim()) {
        mensaje += '• Estantería (obligatoria para BODEGA QUITO)\n';
      }

      this.mostrarAlerta(mensaje, 'warning');
    } else {
      // Si no está deshabilitado, ejecutar movimiento
      console.log('Ejecutando movimiento...');
      this.ejecutarMovimiento();
    }
  }
  // Método para buscar producto por código y ubicación específica
  async buscarProductoPorCodigoYUbicacion(codigo: string, ubicacionId: number): Promise<any> {
    try {
      if (!codigo || codigo.trim() === '') {
        console.log('⚠️ No hay código para buscar');
        return null;
      }

      console.log(`🔍 Buscando producto con código: "${codigo}" en ubicación ID: ${ubicacionId}`);

      // Usar filtros más específicos
      const filtros = {
        search: codigo,
        limit: 50,
        page: 1,
        ubicacion_id: ubicacionId // Filtrar solo por ubicación específica
      };

      const resultado = await this.productosService.getProductos(filtros);

      // Buscar coincidencia exacta del código y que esté activo
      const productoEnUbicacion = resultado.data.find((p: any) =>
        p.codigo === codigo &&
        p.ubicacion_id === ubicacionId &&
        p.esta_activo === true
      );

      if (productoEnUbicacion) {
        console.log(`✅ Producto encontrado en ubicación ${ubicacionId}: ID ${productoEnUbicacion.id}, Stock: ${productoEnUbicacion.cantidad_actual}`);
      } else {
        console.log(`❌ No se encontró producto con código "${codigo}" en ubicación ${ubicacionId}`);
      }

      return productoEnUbicacion || null;
    } catch (error) {
      console.error('Error en búsqueda:', error);
      return null;
    }
  }










  // ESCENARIO 1: Manejar movimiento de producto seriado - VERSIÓN FINAL
  async manejarMovimientoSeriado() {
    console.log('🔄 Procesando movimiento de producto SERIADO');

    const ubicacionDestinoId = this.getUbicacionIdPorNombre(this.formMovimiento.ubicacion_destino);

    if (!ubicacionDestinoId) {
      throw new Error('Ubicación destino no válida');
    }

    // Preparar datos de actualización - AÑADIR estanteria
    const updateData: any = {
      ubicacion_id: ubicacionDestinoId
    };

    // IMPORTANTE: Si el destino es BODEGA QUITO, actualizar estantería
    if (ubicacionDestinoId === 9) {
      updateData.estanteria = this.formMovimiento.estanteria;
    } else {
      // Si NO es BODEGA QUITO, limpiar la estantería
      updateData.estanteria = '';
    }

    console.log('📝 Actualizando producto seriado con:', updateData);

    // 1. Actualizar producto con los nuevos datos
    await this.productosService.updateProducto(this.productoSeleccionado.id, updateData);

    // 2. Registrar movimiento
    const movimientoData = {
      tipo_evento: this.formMovimiento.tipo_evento,
      producto_id: this.productoSeleccionado.id,
      cantidad: 1,
      estado_evento: this.formMovimiento.estado_evento,
      motivo: this.formMovimiento.motivo,
      ubicacion_origen: this.formMovimiento.ubicacion_origen || this.productoSeleccionado.ubicacion_nombre,
      ubicacion_destino: this.formMovimiento.ubicacion_destino,
      detalles: this.formMovimiento.detalles,
      observaciones: this.formMovimiento.observaciones
    };

    await this.trazabilidadService.registrarMovimiento(movimientoData);

    console.log('✅ Producto seriado movido y estantería actualizada');
  }
  // ESCENARIO 2: Producto NO seriado en BODEGA QUITO
  async manejarMovimientoDesdeBodegaQuito() {
    console.log('🔄 Procesando movimiento desde BODEGA QUITO');

    const ubicacionDestinoId = this.getUbicacionIdPorNombre(this.formMovimiento.ubicacion_destino);

    if (!ubicacionDestinoId) {
      throw new Error('Ubicación destino no válida');
    }

    // 1. Crear nuevo producto con datos del original
    // 1. Crear nuevo producto con datos del original
    const nuevoProducto = {
      nombre: this.productoSeleccionado.nombre,
      descripcion: this.productoSeleccionado.descripcion,
      componente: this.productoSeleccionado.componente,
      criticidad: this.productoSeleccionado.criticidad,
      part_number: this.productoSeleccionado.part_number,
      codigo: this.productoSeleccionado.codigo,
      serial_number: '', // Sin serial para no seriado
      estado: this.productoSeleccionado.estado,
      cantidad_actual: this.formMovimiento.cantidad,
      ubicacion_id: ubicacionDestinoId,

      estanteria: this.productoSeleccionado.estanteria,
      precio: this.productoSeleccionado.precio,
      fecha_adquisicion: new Date().toISOString().split('T')[0], // Fecha actual
      orden_envio: null, // Agregado
      factura: null, // Agregado
      observaciones: `Creado por movimiento desde producto ID: ${this.productoSeleccionado.id}`
    };

    const productoNuevo = await this.productosService.createProducto(nuevoProducto);

    // 2. Reducir cantidad del producto original
    const nuevaCantidadOriginal = this.productoSeleccionado.cantidad_actual - this.formMovimiento.cantidad;

    if (nuevaCantidadOriginal > 0) {
      await this.productosService.updateProducto(this.productoSeleccionado.id, {
        cantidad_actual: nuevaCantidadOriginal
      });
    } else {
      // Si queda en 0, desactivar el producto
      await this.productosService.desactivarProducto(this.productoSeleccionado.id, 'Cantidad agotada por movimiento');
    }

    // 3. Registrar movimiento para el nuevo producto
    const movimientoData = {
      tipo_evento: this.formMovimiento.tipo_evento,
      producto_id: productoNuevo.id,
      cantidad: this.formMovimiento.cantidad,
      estado_evento: this.formMovimiento.estado_evento,
      motivo: this.formMovimiento.motivo,
      ubicacion_origen: 'BODEGA QUITO',
      ubicacion_destino: this.formMovimiento.ubicacion_destino,
      detalles: this.formMovimiento.detalles,
      observaciones: this.formMovimiento.observaciones
    };

    await this.trazabilidadService.registrarMovimiento(movimientoData);

    console.log('✅ Nuevo producto creado desde BODEGA QUITO');
  }

  // ESCENARIO 3: Producto NO seriado en otra ubicación (NO BODEGA QUITO)
  // ESCENARIO 3: Producto NO seriado en otra ubicación (NO BODEGA QUITO)
  // ESCENARIO 3: Producto NO seriado en otra ubicación (NO BODEGA QUITO) - CORREGIDO
  async manejarMovimientoDesdeOtraUbicacion() {
    console.log('🔄 Procesando movimiento desde otra ubicación a BODEGA QUITO');

    // Forzar que el destino sea BODEGA QUITO
    const bodegaQuito = this.ubicaciones.find(u => u.id === 9);
    if (!bodegaQuito) {
      throw new Error('BODEGA QUITO no encontrada en ubicaciones');
    }

    // Establecer ubicaciones en el formulario
    this.formMovimiento.ubicacion_destino = bodegaQuito.nombre;

    // 1. Buscar si ya existe un producto con el mismo código en BODEGA QUITO
    let productoEnBodega = null;
    if (this.productoSeleccionado.codigo) {
      productoEnBodega = await this.buscarProductoEnBodegaQuito(this.productoSeleccionado.codigo);
    }

    // 2. Calcular nueva cantidad para el producto original
    const nuevaCantidadOriginal = this.productoSeleccionado.cantidad_actual - this.formMovimiento.cantidad;

    // 3. Manejar el producto original
    if (nuevaCantidadOriginal > 0) {
      // CASO 3A: Cantidad parcial - Actualizar cantidad del producto original
      await this.productosService.updateProducto(this.productoSeleccionado.id, {
        cantidad_actual: nuevaCantidadOriginal
      });
    } else {
      // CASO 3B: Cantidad total (nuevaCantidadOriginal <= 0) - Desactivar el producto original
      await this.productosService.desactivarProducto(
        this.productoSeleccionado.id,
        `Producto movido completamente a BODEGA QUITO. Cantidad movida: ${this.formMovimiento.cantidad}`
      );
    }

    // 4. Manejar el producto en BODEGA QUITO (CORREGIDO)
    if (productoEnBodega) {
      // CASO 3A: Producto existe en Bodega Quito - Sumar la cantidad
      const nuevaCantidadBodega = productoEnBodega.cantidad_actual + this.formMovimiento.cantidad;

      // ACTUALIZAR el producto existente en Bodega Quito
      await this.productosService.updateProducto(productoEnBodega.id, {
        cantidad_actual: nuevaCantidadBodega
      });

      console.log(`✅ Cantidad actualizada en BODEGA QUITO: ${productoEnBodega.cantidad_actual} + ${this.formMovimiento.cantidad} = ${nuevaCantidadBodega}`);
    } else {
      // CASO 3B: Producto NO existe en Bodega Quito - Crear nuevo producto
      const nuevoProducto = {
        nombre: this.productoSeleccionado.nombre,
        descripcion: this.productoSeleccionado.descripcion,
        componente: this.productoSeleccionado.componente,
        criticidad: this.productoSeleccionado.criticidad,
        part_number: this.productoSeleccionado.part_number,
        codigo: this.productoSeleccionado.codigo,
        serial_number: '',
        estado: this.productoSeleccionado.estado,
        cantidad_actual: this.formMovimiento.cantidad, // Usar la cantidad movida, no la original
        ubicacion_id: 9, // BODEGA QUITO

        estanteria: this.productoSeleccionado.estanteria,
        precio: this.productoSeleccionado.precio,
        fecha_adquisicion: new Date().toISOString().split('T')[0],
        orden_envio: null,
        factura: null,
        observaciones: `Creado por movimiento desde producto ID: ${this.productoSeleccionado.id}`
      };

      await this.productosService.createProducto(nuevoProducto);
      console.log(`✅ Nuevo producto creado en BODEGA QUITO con cantidad: ${this.formMovimiento.cantidad}`);
    }

    // 5. Registrar movimiento (IMPORTANTE: usar el ID del producto en Bodega Quito si existe)
    const productoIdParaMovimiento = productoEnBodega ? productoEnBodega.id : this.productoSeleccionado.id;

    const movimientoData = {
      tipo_evento: this.formMovimiento.tipo_evento,
      producto_id: productoIdParaMovimiento,
      cantidad: this.formMovimiento.cantidad,
      estado_evento: this.formMovimiento.estado_evento,
      motivo: this.formMovimiento.motivo,
      ubicacion_origen: this.formMovimiento.ubicacion_origen || this.productoSeleccionado.ubicacion_nombre,
      ubicacion_destino: bodegaQuito.nombre,
      detalles: this.formMovimiento.detalles,
      observaciones: this.formMovimiento.observaciones
    };

    await this.trazabilidadService.registrarMovimiento(movimientoData);

    console.log('✅ Producto movido desde otra ubicación a BODEGA QUITO');
  }
  async verMovimientos(producto: any) {
    // Ocultar paginación al ver movimientos
    this.showPagination = false;

    this.productoSeleccionado = producto;
    this.vistaActual = 'movimientos';

    // Prevenir scroll del body
    document.body.style.overflow = 'hidden';

    await this.cargarMovimientosProducto(producto.id);
  }

  // ==================== MÉTODOS HELPER PARA TEMPLATE ====================

  // Método para calcular stock después del movimiento
  // Método para calcular stock después del movimiento
  getStockDespues(): number {
    if (!this.productoSeleccionado) return 0;

    const stockActual = this.productoSeleccionado.cantidad_actual;
    const cantidad = this.formMovimiento.cantidad;

    switch (this.formMovimiento.tipo_evento) {
      case 'entrada':
      case 'devolucion':
        return stockActual + cantidad;
      case 'salida':
      case 'transferencia':
      case 'consumo':  // AÑADIDO AQUÍ
        return stockActual - cantidad;
      case 'ajuste':
        return cantidad; // Para ajustes, se establece el valor directamente
      default:
        return stockActual;
    }
  }
  // Método para obtener texto del tipo de movimiento
  // Método para obtener texto del tipo de movimiento
  getTipoMovimientoTexto(tipo: string): string {
    const tipos: { [key: string]: string } = {
      'entrada': 'Entrada de Stock',
      'salida': 'Salida de Stock',
      'ajuste': 'Ajuste de Inventario',
      'transferencia': 'Transferencia',
      'consumo': 'Consumo',  // CAMBIADO: de 'Consumo' (con C mayúscula) a 'consumo'
      'devolucion': 'Devolución'
    };
    return tipos[tipo] || tipo;
  }

  // Método para verificar si es movimiento de stock (para compatibilidad)
  private esMovimientoStock(tipo: string): tipo is 'entrada' | 'salida' | 'ajuste' {
    return tipo === 'entrada' || tipo === 'salida' || tipo === 'ajuste';
  }

  // ==================== UTILIDADES ====================

  mostrarAlerta(mensaje: string, tipo: 'success' | 'error' | 'warning' = 'success', autoCerrar: boolean = true) {
    this.alerta = {
      mostrar: true,
      tipo,
      mensaje,
      autoCerrar
    };

    if (autoCerrar) {
      setTimeout(() => {
        this.alerta.mostrar = false;
      }, 5000);
    }
  }

  cerrarAlerta() {
    this.alerta.mostrar = false;
  }

  volver() {
    // Mostrar paginación al volver a lista
    this.showPagination = true;

    this.vistaActual = 'lista';
    this.productoSeleccionado = null;

    // Restaurar scroll del body
    document.body.style.overflow = '';
  }

  // ==================== GETTERS PARA TEMPLATE ====================

  getEstadoStockClase(producto: any): string {
    return producto.cantidad_actual <= 0
      ? 'bg-danger-subtle text-danger-emphasis'
      : 'bg-success-subtle text-success-emphasis';
  }

  getEstadoStockIcono(producto: any): string {
    if (producto.cantidad_actual <= 0) return 'bi-x-circle';
    return 'bi-check-circle';
  }

  getCriticidadClase(producto: any): string {
    switch (producto.criticidad) {
      case 'Bajo': return 'bg-success-subtle text-success-emphasis';
      case 'Medio': return 'bg-warning-subtle text-warning-emphasis';
      case 'Alto': return 'bg-danger-subtle text-danger-emphasis';
      case 'Critico': return 'bg-dark text-white';
      default: return 'bg-secondary-subtle';
    }
  }

  getMovimientoIcono(tipo: string): string {
    switch (tipo) {
      case 'entrada': return 'bi-box-arrow-in-down text-success';
      case 'salida': return 'bi-box-arrow-up text-danger';
      case 'transferencia': return 'bi-arrow-left-right text-primary';
      case 'consumo': return 'bi-lightning text-warning'; // O el icono que prefieras
      default: return 'bi-arrow-repeat text-warning';
    }
  }
  tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }
  getMovimientoClase(tipo: string): string {
    switch (tipo) {
      case 'entrada': return 'border-start border-success border-5';
      case 'salida': return 'border-start border-danger border-5';
      case 'transferencia': return 'border-start border-primary border-5';
      case 'consumo': return 'border-start border-warning border-5';
      default: return 'border-start border-warning border-5';
    }
  }































  // Agrega estas propiedades en la clase
  confirmacionEliminacion = {
    mostrar: false,
    paso: 1,
    textoConfirmacion: '',
    eliminando: false
  };

  // Método para abrir la confirmación
  abrirConfirmacionEliminacion() {

    this.confirmacionEliminacion = {
      mostrar: true,
      paso: 1,
      textoConfirmacion: '',
      eliminando: false
    };
  }

  // Método para cerrar la confirmación
  cerrarConfirmacionEliminacion() {
    this.confirmacionEliminacion.mostrar = false;
    this.confirmacionEliminacion.paso = 1;
    this.confirmacionEliminacion.textoConfirmacion = '';
  }

  // Método para avanzar en la confirmación
  // Método para avanzar en la confirmación
  avanzarConfirmacion() {
    if (this.confirmacionEliminacion.paso === 1) {
      // Paso 1: Advertencia inicial
      this.confirmacionEliminacion.paso = 2;
    } else if (this.confirmacionEliminacion.paso === 2) {
      // Paso 2: Ingresar texto de confirmación
      if (this.confirmacionEliminacion.textoConfirmacion?.toUpperCase() === 'ELIMINAR') {
        this.confirmacionEliminacion.paso = 3;
        // **CORRECCIÓN: Ejecutar automáticamente la eliminación sin más pasos**
        this.ejecutarEliminacionTotal();
      } else {
        this.mostrarAlerta('Texto incorrecto. Debe escribir exactamente: ELIMINAR', 'error');
      }
    }
  }

  // Método principal para ejecutar la eliminación
  // Método principal para ejecutar la eliminación
  async ejecutarEliminacionTotal() {
    try {
      this.confirmacionEliminacion.eliminando = true;

      // Ejecutar el truncate completo
      const resultado = await this.productosService.ejecutarTruncateCompleto();

      this.mostrarAlerta(resultado.mensaje, 'success');

      // **No cerrar el modal inmediatamente - mostrar estado de éxito**
      // Esperar 2 segundos para que el usuario vea el mensaje de éxito
      setTimeout(() => {
        // Cerrar el modal
        this.cerrarConfirmacionEliminacion();

        // Recargar la página después de 1 segundo adicional
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }, 2000);

    } catch (error: any) {
      console.error('❌ Error eliminando registros:', error);
      this.mostrarAlerta(`Error: ${error.message}`, 'error');
      // En caso de error, también cerrar el modal después de 3 segundos
      setTimeout(() => {
        this.cerrarConfirmacionEliminacion();
      }, 3000);
    } finally {
      // Nota: No establecemos eliminando en false aquí porque queremos que el indicador
      // permanezca hasta que se cierre el modal
    }
  }

  // Método auxiliar para verificar si el texto es correcto
  textoConfirmacionValido(): boolean {
    return this.confirmacionEliminacion.textoConfirmacion?.toUpperCase() === 'ELIMINAR';
  }
}