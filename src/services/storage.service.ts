import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private bucketName = 'documentos';

  constructor() { 
  }

  // ==================== MÉTODOS PÚBLICOS PERMANENTES ====================

  /**
   * Subir archivo y obtener URL PÚBLICA (permanente)
   */
  async uploadFile(file: File, folder: string): Promise<string> {
    try {
      // Obtener usuario actual
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado');

      // Generar nombre único
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${folder}/${user.id}/${timestamp}_${randomStr}_${safeName}`;
 

      // Subir archivo
      const { error } = await supabase.storage
        .from(this.bucketName)
        .upload(fileName, file, {
          cacheControl: '31536000', // 1 año de cache
          upsert: false,
          contentType: file.type
        });

      if (error) throw error;

      // Obtener URL PÚBLICA (permanente, sin token)
      const publicUrl = this.getPublicUrl(fileName);
       
      return publicUrl;

    } catch (error: any) {
      console.error('❌ Error subiendo archivo:', error);
      throw new Error(`Error subiendo archivo: ${error.message}`);
    }
  }

  /**
   * Obtener URL pública (permanente, sin token)
   */
  getPublicUrl(filePath: string): string {
    const { data: { publicUrl } } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);
    
    return publicUrl;
  }

  /**
   * Eliminar archivo del storage
   */
  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      if (!fileUrl) return true;
      
      // Extraer nombre del archivo
      const fileName = this.extractFileName(fileUrl);
      
      if (!fileName) { 
        return false;
      }
 

      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([fileName]);

      if (error) {
        // Si el archivo no existe, lo consideramos éxito
        if (error.message.includes('not found')) {
          console.log('⚠️ Archivo no encontrado (posiblemente ya eliminado)');
          return true;
        }
        throw error;
      }
 
      return true;

    } catch (error: any) {
      console.error('❌ Error eliminando archivo:', error);
      return false;
    }
  }

  // ==================== MÉTODOS AUXILIARES ====================

  /**
   * Extraer nombre del archivo desde URL
   */
  private extractFileName(fileUrl: string): string | null {
    try {
      if (!fileUrl || !fileUrl.includes('supabase.co')) {
        return fileUrl; // Si ya es un nombre, devolverlo
      }

      const url = new URL(fileUrl);
      const pathParts = url.pathname.split('/');
      const bucketIndex = pathParts.indexOf(this.bucketName);
      
      if (bucketIndex !== -1) {
        return pathParts.slice(bucketIndex + 1).join('/');
      }
      
      return null;
    } catch (error) {
      console.error('Error extrayendo nombre:', error);
      return null;
    }
  }

  /**
   * Validar archivo
   */
  validateFile(file: File): { valid: boolean; message?: string } {
    const maxSizeMB = 5;
    const maxSize = maxSizeMB * 1024 * 1024;
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf'
    ];

    if (file.size > maxSize) {
      return {
        valid: false,
        message: `El archivo excede el tamaño máximo de ${maxSizeMB}MB`
      };
    }

    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        message: 'Tipo de archivo no permitido. Solo imágenes y PDF'
      };
    }

    return { valid: true };
  }
}