import { Injectable } from '@angular/core';
import { Router, CanActivate } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  async canActivate(): Promise<boolean> {
    try {
      const session = await this.authService.getCurrentSession();
      
      if (session) {
        return true; // Usuario autenticado, permite acceso
      } else {
        // Usuario no autenticado, redirige a login
        this.router.navigate(['/login']);
        return false;
      }
    } catch (error) {
      console.error('Error en AuthGuard:', error);
      this.router.navigate(['/login']);
      return false;
    }
  }
}