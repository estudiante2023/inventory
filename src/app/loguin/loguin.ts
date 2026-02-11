import { Component } from '@angular/core';
import {  OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service'; // Ajusta la ruta según tu estructura
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loguin',
  imports: [CommonModule,FormsModule,ReactiveFormsModule],
  templateUrl: './loguin.html',
  styleUrl: './loguin.css',
})
export class Loguin implements OnInit {
  loginForm: FormGroup;
  isLoginMode = true; // true para login, false para registro
  loading = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      // Solo para registro
      nombre_completo: ['']
    });
  }

  ngOnInit(): void {
    // Si el usuario ya está autenticado, redirigir al dashboard
    this.authService.getCurrentSession().then(session => {
      if (session) {
        this.router.navigate(['/inicio']);
      }
    });
  }

  // Cambiar entre login y registro
  switchMode() {
    this.isLoginMode = !this.isLoginMode;
    this.errorMessage = '';
    // Limpiar el formulario
    this.loginForm.reset();
    // Si cambiamos a registro, agregar validación para nombre_completo
    if (!this.isLoginMode) {
      this.loginForm.get('nombre_completo')?.setValidators([Validators.required]);
    } else {
      this.loginForm.get('nombre_completo')?.clearValidators();
    }
    this.loginForm.get('nombre_completo')?.updateValueAndValidity();
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      return;
    }

    this.loading = true;
    this.errorMessage = '';

    const { email, password, nombre_completo } = this.loginForm.value;

    try {
      if (this.isLoginMode) {
        // Login
        await this.authService.signIn(email, password);
        this.router.navigate(['/dashboard']);
      } else {
        // Registro
        const userMetadata = nombre_completo ? { nombre_completo } : undefined;
        await this.authService.signUp(email, password, userMetadata);
        // Después del registro, podrías redirigir a una página de confirmación o hacer login automático
        // En este caso, Supabase requiere que el usuario confirme su email (dependiendo de la configuración)
        // Podemos mostrar un mensaje y cambiar a modo login
        alert('Registro exitoso. Por favor, revisa tu email para confirmar la cuenta.');
        this.isLoginMode = true;
        this.loginForm.reset();
      }
    } catch (error: any) {
      this.errorMessage = error.message || 'Ocurrió un error';
    } finally {
      this.loading = false;
    }
  }
}