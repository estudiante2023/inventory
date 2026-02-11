import { Component } from '@angular/core';
import { AuthService } from '../services/auth.service'; 
import { Navegacion } from "./navegacion/navegacion";  
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';  

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  imports: [Navegacion, FormsModule, CommonModule, RouterOutlet]
})
export class App {
  constructor(public authService: AuthService) {}
}