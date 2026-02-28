// services/email.service.ts - VERSIÓN CORREGIDA
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { ProductoCompleto } from '../app/moldes/producto.model';

@Injectable({
  providedIn: 'root'
})
export class EmailService {
  
  constructor() { 
  }

async obtenerCorreosUsuarios(): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('get_all_active_emails');
    if (error) throw error;
    return (data || []).map((item: { email: string }) => item.email);
  } catch (error) {
    console.error('Error obteniendo correos:', error);
    return [];
  }
}


/**
 * Obtiene los correos electrónicos de los usuarios con rol 'admin' y activos.
 * @returns Promise<string[]> - Lista de correos de administradores.
 */
async obtenerCorreosAdmin(): Promise<string[]> {
  try {
    // Opción 1: Usar una función RPC específica (si ya existe)
    const { data, error } = await supabase.rpc('get_admin_emails'); 
    if (error) throw error;
    return (data || []).map((item: { email: string }) => item.email);
  } catch (error) {
    console.error('Error obteniendo correos de administradores:', error);
    return [];
  }
}

  // En email.service.ts - CORREGIDO
async enviarAlertaStockBajo(productos: any[]): Promise<{success: boolean, message: string}> {
  try { 

    // 1. Validar productos
    if (!productos || productos.length === 0) {
      return {
        success: false,
        message: 'No hay productos con stock bajo'
      };
    }

    // 2. Obtener stock mínimo de configuraciones
    let stockMinimo = 3;
    try {
      const { data: configData } = await supabase
        .from('configuraciones')
        .select('valor')
        .eq('clave', 'cantidad_minima')
        .single();
      
      if (configData) {
        stockMinimo = parseInt(configData.valor) || 3;
      }
    } catch (error) {
      console.warn('No se pudo obtener stock mínimo, usando valor por defecto:', error);
    }

    // 3. Obtener correos
    const correos = await this.obtenerCorreosUsuarios();
    
    if (correos.length === 0) {
      return {
        success: false,
        message: 'No se encontraron correos para enviar alerta'
      };
    }

    // 4. Generar contenido con el stock mínimo obtenido
    const asunto = `🚨 ALERTA: ${productos.length} grupos de repuestos con stock bajo`;
    const html = this.generarCuerpoEmail(productos, stockMinimo);
 

    // 5. Llamar a la Edge Function
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const { data, error } = await supabase.functions.invoke('send-stock-alert', {
      body: {
        to: correos,
        subject: asunto,
        html: html,
        motivo: 'Alerta automática de stock bajo',
        totalGrupos: productos.length,
        stockMinimo: stockMinimo
      },
      headers: {
        Authorization: token ? `Bearer ${token}` : ''
      }
    });
 

    if (error) {
      console.error('❌ Error de Edge Function:', error);
      return {
        success: false,
        message: `Error al enviar: ${error.message || 'Error desconocido'}`
      };
    }

    if (data && data.success === true) { 
      return {
        success: true,
        message: `✅ Alerta enviada exitosamente a ${correos.length} usuarios`
      };
    } else {
      console.error('❌ Respuesta inesperada:', data);
      return {
        success: false,
        message: 'Respuesta inesperada de la función'
      };
    }

  } catch (error: any) {
    console.error('❌ Error general:', error);
    return {
      success: false,
      message: `Error: ${error.message || 'Error desconocido'}`
    };
  }
}

// email.service.ts

async enviarReporteMovimiento(detalleMovimiento: any): Promise<{success: boolean, message: string}> {
  
  try {
    const correos = await this.obtenerCorreosAdmin();
    if (correos.length === 0) {
      return { success: false, message: 'No hay correos destinatarios' };
    }

    const asunto = `📦 Reporte de movimiento - ${new Date().toLocaleString()}`;
    const html = this.generarReporteMovimientoHTML(detalleMovimiento);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const { data, error } = await supabase.functions.invoke('send-stock-alert', {
      body: {
        to: correos,
        subject: asunto,
        html: html,
        motivo: 'Reporte de movimiento de inventario'
      }
    });

    if (error) throw error;
    return { success: true, message: 'Reporte enviado ffffffffffff' };
  } catch (error) {
    console.error('Error enviando reporte:', error);
    return { success: false, message: 'Error al enviar reportefffffffffff' };
  }
}

private generarReporteMovimientoHTML(detalle: any): string {
  const fecha = new Date().toLocaleString('es-ES');
  let productosHtml = '';

  detalle.productos.forEach((p: any) => {
    productosHtml += `
      <tr>
        <td>${p.id}</td>
        <td>${p.nombre}</td>
        <td>${p.codigo || '-'}</td>
        <td>${p.part_number || '-'}</td>
        <td>${p.serial_number || '-'}</td>
        <td>${p.cantidad}</td>
        <td>${p.ubicacion_origen}</td>
        <td>${p.ubicacion_destino}</td>
      </tr>
    `;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        h2 { color: #333; }
      </style>
    </head>
    <body>
      <h2>📋 Reporte de Movimiento de Inventario</h2>
      <p><strong>Fecha:</strong> ${fecha}</p>
      <p><strong>Tipo de movimiento:</strong> ${detalle.tipo}</p>
      <p><strong>Motivo:</strong> ${detalle.motivo}</p>
      <p><strong>Observaciones:</strong> ${detalle.observaciones || 'Ninguna'}</p>
      <p><strong>Usuario:</strong> ${detalle.usuario || 'Sistema'}</p>
      <h3>Productos movidos:</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Código</th>
            <th>Part Number</th>
            <th>Serial</th>
            <th>Cantidad</th>
            <th>Origen</th>
            <th>Destino</th>
          </tr>
        </thead>
        <tbody>${productosHtml}</tbody>
      </table>
      <p><em>Fin del reporte</em></p>
    </body>
    </html>
  `;
}

















// Método CORREGIDO para generar el cuerpo del email con TODAS las columnas
// En email.service.ts - Método ACTUALIZADO con todos los campos
private generarCuerpoEmail(productos: any[], stockMinimo: number): string {
  const fecha = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background-color: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #ffc107; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 11px; }
        .table th { background-color: #f8f9fa; padding: 8px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: bold; }
        .table td { padding: 8px; text-align: left; border-bottom: 1px solid #dee2e6; vertical-align: top; }
        .badge { padding: 3px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; }
        .badge-danger { background-color: #f8d7da; color: #721c24; }
        .badge-warning { background-color: #fff3cd; color: #856404; }
        .badge-info { background-color: #d1ecf1; color: #0c5460; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
        .total { font-size: 16px; font-weight: bold; margin: 15px 0; color: #856404; }
        .text-small { font-size: 10px; }
        .text-truncate { max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .highlight { background-color: #fff3cd; }
        .section-title { background-color: #e9ecef; padding: 8px; margin: 15px 0 10px 0; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🚨 ALERTA DE STOCK BAJO (VISTA AGRUPADA)</h2>
          <p><strong>Fecha:</strong> ${fecha}</p>
          <p><strong>Total grupos de repuestos:</strong> ${productos.length}</p>
          <p><strong>Stock mínimo configurado:</strong> ${stockMinimo} unidades</p>
          <p><strong>Nota:</strong> Repuestos agrupados por Part Number (suma de cantidades)</p>
        </div>

        <div class="total">
          📋 LISTA DE REPUESTOS CON STOCK BAJO (${productos.length} grupos)
        </div>
        
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Código</th>
              <th>Part Number</th>
              <th>Serial(s)</th>
              <th>Stock Total</th>
              <th>Items</th>
              <th>Estado</th>
              <th>Criticidad</th>
              <th>Componente</th>
              <th>Ubicación</th>
              <th>Precio</th>
              <th>Fecha Adq.</th>
              <th>Orden</th>
              <th>Factura</th> 
            </tr>
          </thead>
          <tbody>
  `;

  let totalItemsIndividuales = 0;
  let totalValorInventario = 0;

  productos.forEach((producto, index) => {
    // Calcular totales
    const itemsAgrupados = producto.cantidad_items || 1;
    totalItemsIndividuales += itemsAgrupados;
    totalValorInventario += producto.valor_total || 0;

    // Calcular diferencia con stock mínimo
    const diferencia = producto.cantidad_actual - stockMinimo;
    const diferenciaClase = diferencia < 0 ? 'badge-danger' : 'badge-info';
    const diferenciaTexto = diferencia < 0 ? diferencia : `+${diferencia}`;
    
    // Determinar estado
    const estado = producto.cantidad_actual === 0 ? 'AGOTADO' : 'BAJO';
    const estadoBadge = producto.cantidad_actual === 0 
      ? '<span class="badge badge-danger">AGOTADO</span>'
      : '<span class="badge badge-warning">BAJO</span>';

    // Formatear valores
    const precioFormateado = producto.precio 
      ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD' }).format(producto.precio)
      : '$0.00';

    

    // Formatear fecha
    const fechaFormateada = producto.fecha_adquisicion 
      ? new Date(producto.fecha_adquisicion).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '';

    // Truncar serials si son muy largos
    let serialsMostrar = producto.serial_number || '';
    if (serialsMostrar.length > 50) {
      serialsMostrar = serialsMostrar.substring(0, 50) + '...';
    }

    // Ver si es part number especial
    const esSinPartNumber = producto.part_number?.includes('SIN_PART_NUMBER');
    const partNumberMostrar = esSinPartNumber 
      ? `<span style="color: #6c757d; font-style: italic;">SIN PART NUMBER</span>` 
      : producto.part_number;

    // Filas alternadas para mejor lectura
    const rowClass = index % 2 === 0 ? '' : 'style="background-color: #f9f9f9;"';

    html += `
      <tr ${rowClass}>
        <td class="text-small">#${producto.id}</td>
        <td class="text-truncate" title="${producto.nombre || ''}">${producto.nombre || ''}</td>
        <td>${producto.codigo || ''}</td>
        <td>${partNumberMostrar}</td>
        <td class="text-small text-truncate" title="${producto.serial_number || ''}">${serialsMostrar}</td>
        <td><strong style="font-size: 12px;">${producto.cantidad_actual}</strong></td>
        <td><span class="badge" style="background-color: #e9ecef;">${itemsAgrupados}</span></td>
        <td>${estadoBadge}</td>
        <td>${producto.criticidad || 'medio'}</td>
        <td class="text-truncate" title="${producto.componente || ''}">${producto.componente || ''}</td>
        <td class="text-truncate" title="${producto.ubicacion_nombre || ''}">${producto.ubicacion_nombre || 'Sin ubicación'}</td>
        <td class="text-small">${precioFormateado}</td>
        <td class="text-small">${fechaFormateada}</td>
        <td>${producto.orden_envio ? '<span style="color: green;">✓</span>' : '-'}</td>
        <td>${producto.factura ? '<span style="color: green;">✓</span>' : '-'}</td> 
      </tr>
      
      <!-- Fila adicional para observaciones si existen -->
      ${producto.observaciones ? `
      <tr ${rowClass}>
        <td colspan="16" class="text-small" style="padding-left: 30px; color: #6c757d;">
          📝 <strong>Observaciones:</strong> ${producto.observaciones}
        </td>
      </tr>
      ` : ''}
    `;
  });

  // Agregar resumen
  const agotados = productos.filter(p => p.cantidad_actual === 0).length;
  const bajoStock = productos.filter(p => p.cantidad_actual > 0 && p.cantidad_actual <= stockMinimo).length; 

  html += `
          </tbody>
        </table>

        <div class="section-title">📊 RESUMEN DETALLADO</div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0;">
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px;">
            <h4 style="margin-top: 0;">📦 INVENTARIO</h4>
            <table style="width: 100%;">
              <tr>
                <td><strong>Grupos de repuestos:</strong></td>
                <td>${productos.length}</td>
              </tr>
              <tr>
                <td><strong>Items individuales:</strong></td>
                <td>${totalItemsIndividuales}</td>
              </tr>
              
            </table>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px;">
            <h4 style="margin-top: 0;">⚠️ ESTADO STOCK</h4>
            <table style="width: 100%;">
              <tr>
                <td><strong>Agotados:</strong></td>
                <td><span style="color: #dc3545;">${agotados}</span></td>
              </tr>
              <tr>
                <td><strong>Bajo stock:</strong></td>
                <td><span style="color: #ffc107;">${bajoStock}</span></td>
              </tr> 
            </table>
          </div>
        </div>

        <div style="padding: 15px; background-color: #e7f3ff; border-left: 4px solid #2196F3; margin: 20px 0;">
          <h4>🔧 ACCIONES RECOMENDADAS</h4>
          <ol>
            <li><strong>Revisar repuestos agotados (${agotados})</strong> - Necesitan atención inmediata</li>
            
            
            <li><strong>Actualizar stock mínimo</strong> si los niveles actuales (${stockMinimo}) no son adecuados</li> 
          </ol>
        </div>

        <div class="footer">
          <p><em>📋 <strong>VISTA AGRUPADA:</strong> Repuestos agrupados por Part Number con suma de cantidades.</em></p>
          <p><em>📊 Cada fila representa un grupo de repuestos con el mismo Part Number.</em></p>
          <p><em>📍 Sistema de Inventario Automático - No responder este mensaje</em></p>
        </div>
      </div>
    </body>
    </html>
  `;

  return html;
}
}