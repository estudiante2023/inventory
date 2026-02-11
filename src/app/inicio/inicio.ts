import { Component, ElementRef, HostListener, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsuariosOnlineService } from '../../services/usuarios-online.service';
import { ProductosService } from '../../services/productos.service';
import { TrazabilidadService } from '../../services/trazabilidad.service';
import { EmailService } from '../../services/email.service';

@Component({
  selector: 'app-inicio',
  imports: [CommonModule],
  templateUrl: './inicio.html',
  styleUrl: './inicio.css',
})
export class Inicio implements OnInit, OnDestroy {

  @ViewChild('chartdiv') chartDiv!: ElementRef<HTMLCanvasElement>;
  private chartContext: CanvasRenderingContext2D | null = null;

  // Variables para datos
  usuariosOnline: any[] = [];
  estadisticas: any = null;
  movimientosHoy: number = 0;
  


  // Variables para el envío de correos
  enviandoCorreo: boolean = false;
  mensajeCorreo: string = '';
  
  // Timers
  private usuariosInterval: any;
  private movimientosInterval: any;

  constructor(
    private usuariosOnlineService: UsuariosOnlineService,
    private productosService: ProductosService,
    private trazabilidadService: TrazabilidadService,
    private emailService: EmailService
  ) {}

  async ngOnInit() {
    // Cargar datos iniciales
    await this.cargarUsuariosOnline();
    await this.cargarEstadisticas();
    await this.cargarMovimientosHoy();
    
    // Actualizar usuarios en línea cada 30 segundos
    this.usuariosInterval = setInterval(() => {
      this.cargarUsuariosOnline();
    }, 30000);
    
    // Actualizar movimientos hoy cada 2 minutos
    this.movimientosInterval = setInterval(() => {
      this.cargarMovimientosHoy();
    }, 120000);
  }

  ngAfterViewInit(): void {
    this.renderChart();
  }



// En inicio.ts - CORREGIDO
async enviarAlertaStockBajo() {
  try {
    // CAMBIA ESTA LÍNEA: Usar el método AGRUPADO en lugar del individual
    const productos = await this.productosService.getProductosBajoStockAgrupadosParaAlertas();
    
    if (!productos || productos.length === 0) {
      alert('✅ No hay productos con stock bajo para notificar');
      return;
    }

    // Obtener estadísticas para mostrar en confirmación
    const estadisticas = await this.productosService.getEstadisticas();
    
    // CALCULAR: Cuántos items individuales hay en total
    const totalItemsIndividuales = productos.reduce((sum, p) => sum + (p.cantidad_items || 1), 0);

    const confirmacion = confirm(
      `¿Enviar alerta de stock bajo (VISTA AGRUPADA)?\n\n` +
      `📋 Grupos de productos: ${productos.length}\n` +
      `📦 Items individuales: ${totalItemsIndividuales}\n` +
      `• Bajo stock: ${estadisticas.bajoStock}\n` +
      `• Agotados: ${estadisticas.agotados}\n` +
      `• Stock mínimo: ${estadisticas.cantidadMinima} unidades\n\n` +
      `📧 Se enviará la alerta a todos los usuarios del sistema.`
    );

    if (!confirmacion) return;

    this.enviandoCorreo = true;
    this.mensajeCorreo = 'Enviando alerta por correo...';

    // ✅ CORRECTO: Solo 1 parámetro ahora (productos)
    const resultado = await this.emailService.enviarAlertaStockBajo(productos);
    
    // Mostrar resultado
    this.mensajeCorreo = resultado.message;
    
    if (resultado.success) {
      setTimeout(() => {
        alert(`${resultado.message}\n\n📊 Resumen:\n• Grupos notificados: ${productos.length}\n• Items totales: ${totalItemsIndividuales}`);
        this.mensajeCorreo = '';
      }, 1000);
    } else {
      setTimeout(() => {
        alert(`❌ ${resultado.message}`);
        this.mensajeCorreo = '';
      }, 1000);
    }

  } catch (error: any) {
    console.error('Error enviando alerta:', error);
    this.mensajeCorreo = `❌ Error: ${error.message}`;
    alert(`❌ Error inesperado: ${error.message}`);
  } finally {
    setTimeout(() => {
      this.enviandoCorreo = false;
      this.mensajeCorreo = '';
    }, 3000);
  }
}







  // Método para cargar usuarios en línea
  async cargarUsuariosOnline() {
    try {
      this.usuariosOnline = await this.usuariosOnlineService.obtenerUsuariosOnline();
    } catch (error) {
      console.error('Error cargando usuarios online:', error);
    }
  }

  // Método para cargar estadísticas
  async cargarEstadisticas() {
    try {
      this.estadisticas = await this.productosService.getEstadisticas();
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    }
  }

  // Método para cargar movimientos de hoy
 async cargarMovimientosHoy() {
  try {
    // Inicio del día local (00:00:00)
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    
    // Fin del día local (23:59:59)
    const finDia = new Date();
    finDia.setHours(23, 59, 59, 999);
    
 
    
    const resultado = await this.trazabilidadService.getTrazabilidad({
      fecha_inicio: inicioDia.toISOString(),
      fecha_fin: finDia.toISOString(),
      limit: 1000
    });
    
    this.movimientosHoy = resultado.count || 0;
  } catch (error) {
    console.error('Error cargando movimientos hoy:', error);
  }
}

  // Método para formatear tiempo
  formatearTiempo(fecha: string): string {
    const ahora = new Date();
    const actividad = new Date(fecha);
    const minutos = Math.floor((ahora.getTime() - actividad.getTime()) / 60000);
    
    if (minutos < 1) return 'Ahora';
    if (minutos < 60) return `Hace ${minutos}m`;
    
    const horas = Math.floor(minutos / 60);
    return `Hace ${horas}h`;
  }

  // Resto del código del gráfico (sin cambios)
  private renderChart(): void {
    if (!this.chartDiv?.nativeElement) return;

    const canvas = this.chartDiv.nativeElement;
    this.chartContext = canvas.getContext('2d');
    
    if (!this.chartContext) return;

    // Datos del gráfico
    const data = [
      { month: "Ene", visits: 2025 },
      { month: "Feb", visits: 1882 },
      { month: "Mar", visits: 1809 },
      { month: "Abr", visits: 1322 },
      { month: "May", visits: 1122 },
      { month: "Jun", visits: 1114 },
      { month: "Jul", visits: 984 },
      { month: "Ago", visits: 711 },
      { month: "Sep", visits: 665 },
      { month: "Oct", visits: 580 }
    ];

    this.drawBarChart(this.chartContext, data, canvas.width, canvas.height);
  }

  private drawBarChart(
    ctx: CanvasRenderingContext2D, 
    data: {month: string, visits: number}[], 
    width: number, 
    height: number
  ): void {
    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Configuraciones
    const padding = 40;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    const barWidth = chartWidth / data.length * 0.7;
    const barSpacing = chartWidth / data.length * 0.3;

    // Encontrar valores máximo y mínimo
    const maxVisits = Math.max(...data.map(d => d.visits));
    const minVisits = Math.min(...data.map(d => d.visits));

    // Escala para las visitas
    const scaleY = chartHeight / (maxVisits - minVisits);

    // Dibujar fondo del gráfico
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Dibujar ejes
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dibujar líneas de la cuadrícula
    ctx.strokeStyle = '#EAEDF1';
    ctx.lineWidth = 1;
    
    // Líneas horizontales
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding + (chartHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Dibujar barras y etiquetas
    data.forEach((item, index) => {
      const x = padding + index * (barWidth + barSpacing) + barSpacing / 2;
      const barHeight = (item.visits - minVisits) * scaleY;
      const y = height - padding - barHeight;

      // Dibujar barra con gradiente
      const gradient = ctx.createLinearGradient(x, y, x, height - padding);
      gradient.addColorStop(0, '#1BBAE1');
      gradient.addColorStop(1, '#0A8EBF');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Sombra en la barra
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;
      
      // Borde de la barra
      ctx.strokeStyle = '#0A7BA9';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, barWidth, barHeight);
      
      // Resetear sombra
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Dibujar valor encima de la barra
      ctx.fillStyle = '#333';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.visits.toString(), x + barWidth / 2, y - 8);

      // Dibujar etiqueta del mes
      ctx.fillStyle = '#777';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.month, x + barWidth / 2, height - padding + 20);
    });

    // Dibujar título del eje Y
    ctx.save();
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.translate(padding - 30, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Visitas', 0, 0);
    ctx.restore();

    // Dibujar título del gráfico
    ctx.fillStyle = '#394263';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gasto Mensual', width / 2, padding - 15);

    // Dibujar valores en el eje Y
    ctx.fillStyle = '#777';
    ctx.font = '10px Arial';
    ctx.textAlign = 'right';
    
    const yValues = 5;
    for (let i = 0; i <= yValues; i++) {
      const value = minVisits + (maxVisits - minVisits) * (i / yValues);
      const y = height - padding - (chartHeight * (i / yValues));
      ctx.fillText(Math.round(value).toString(), padding - 10, y + 3);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    // Redibujar el gráfico al redimensionar
    setTimeout(() => {
      if (this.chartDiv?.nativeElement && this.chartContext) {
        const canvas = this.chartDiv.nativeElement;
        // Ajustar tamaño del canvas al contenedor
        const container = canvas.parentElement;
        if (container) {
          canvas.width = container.clientWidth;
        }
        
        const data = [
          { month: "Ene", visits: 2025 },
          { month: "Feb", visits: 1882 },
          { month: "Mar", visits: 1809 },
          { month: "Abr", visits: 1322 },
          { month: "May", visits: 1122 },
          { month: "Jun", visits: 1114 },
          { month: "Jul", visits: 984 },
          { month: "Ago", visits: 711 },
          { month: "Sep", visits: 665 },
          { month: "Oct", visits: 580 }
        ];
        
        this.drawBarChart(this.chartContext, data, canvas.width, canvas.height);
      }
    }, 100);
  }

  ngOnDestroy(): void {
    // Limpiar el canvas
    if (this.chartContext) {
      this.chartContext.clearRect(0, 0, 
        this.chartDiv.nativeElement.width, 
        this.chartDiv.nativeElement.height
      );
    }
    
    // Limpiar intervalos
    if (this.usuariosInterval) {
      clearInterval(this.usuariosInterval);
    }
    if (this.movimientosInterval) {
      clearInterval(this.movimientosInterval);
    }
  }
}