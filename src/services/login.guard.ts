import { Injectable } from '@angular/core';
import { Router, CanActivate } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class LoginGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  async canActivate(): Promise<boolean> {
    try {
      const session = await this.authService.getCurrentSession();
      
      if (session) {
        // Ya está autenticado → Redirige a inicio
        this.router.navigate(['/inicio']);
        return false; // No permite acceso
      }
      
      // No está autenticado → Permite acceso
      return true;
    } catch (error) {
      return true; // Permite acceso en caso de error
    }
  }
}