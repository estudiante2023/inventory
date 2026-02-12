import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, Renderer2, ViewEncapsulation, OnInit, HostListener } from '@angular/core';
import { RouterLink, RouterOutlet, Router, NavigationEnd, RouterLinkActive } from "@angular/router";
import { AuthService } from '../../services/auth.service';
import { UsuariosService } from '../../services/usuarios.service'; // Importar el servicio
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { UsuariosOnlineService } from '../../services/usuarios-online.service';

@Component({
  selector: 'app-navegacion',
  imports: [RouterLink, RouterOutlet, CommonModule,RouterLinkActive],
  templateUrl: './navegacion.html',
  styleUrl: './navegacion.css',
  encapsulation: ViewEncapsulation.Emulated
})
export class Navegacion implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sidenav') sidenavElement!: ElementRef;
  @ViewChild('grid') gridElement!: ElementRef;
  userName: string = 'Usuario';
  // VARIABLE PARA GUARDAR LOS PRIVILEGIOS
  userPrivileges: string[] = [];

  private readonly SIDENAV_ACTIVE_CLASS = 'sidenav--active';
  private readonly SIDENAV_COLLAPSED_CLASS = 'sidenav--collapsed';
  private readonly GRID_NO_SCROLL_CLASS = 'grid--noscroll';
  private readonly GRID_COLLAPSED_CLASS = 'grid--collapsed';

  private listeners: (() => void)[] = [];
  private isLargeScreen = false;
  private routerSubscription!: Subscription;
  usuarios: any[] = [];
  mostrarDetalle: boolean = false;
  ultimaActualizacion: Date = new Date();

  constructor(
    private usuariosOnlineService: UsuariosOnlineService,
    private renderer: Renderer2,
    private authService: AuthService,
    private usuariosService: UsuariosService, // Inyectar el servicio
    private router: Router
  ) { }
  async cargarDatosUsuario() {
    try {
      // Obtener sesión actual
      const session = await this.authService.getCurrentSession();

      if (!session?.user) {
        return;
      }

      const userId = session.user.id;

      // Obtener el perfil del usuario
      const perfil = await this.usuariosService.getUsuarioById(userId);

      // Asignar el nombre
      if (perfil?.nombre_completo) {
        this.userName = perfil.nombre_completo;
      }


    } catch (error) {
      console.error('Error cargando datos:', error);
    }
  }
  textoUsuarios: string = "Cargando...";

  async actualizarTextoUsuarios() {
    try {
      // Obtener texto para el badge
      this.textoUsuarios = await this.usuariosOnlineService.obtenerMensajeUsuariosEnLinea();
      
      // Obtener lista completa de usuarios para el panel
      this.usuarios = await this.usuariosOnlineService.obtenerUsuariosOnline();
      this.ultimaActualizacion = new Date();
      
    } catch (error) {
      console.error('Error actualizando usuarios:', error);
      this.textoUsuarios = "Error";
      this.usuarios = [];
    }
  }


 












  async ngOnInit(): Promise<void> {
    // OBTENER PRIVILEGIOS CUANDO SE INICIALICE EL COMPONENTE
    this.cargarPrivilegios();
    this.cargarDatosUsuario();
    await this.actualizarTextoUsuarios();

    // Actualizar cada 30 segundos (30000ms) o cada 5 minutos (300000ms)
    setInterval(() => {
      this.actualizarTextoUsuarios();
    }, 30000);
  }
  toggleDetalle() {
    this.mostrarDetalle = !this.mostrarDetalle;
  }

  cerrarDetalle() {
    this.mostrarDetalle = false;
  }

  getInicial(nombre: string): string {
    if (!nombre) return 'U';
    return nombre.charAt(0).toUpperCase();
  }

  formatearTiempo(fechaString: string): string {
    const fecha = new Date(fechaString);
    const ahora = new Date();
    const minutos = Math.floor((ahora.getTime() - fecha.getTime()) / 60000);

    if (minutos < 1) return "Ahora mismo";
    if (minutos < 60) return `Hace ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} horas`;

    return `Hace ${Math.floor(horas / 24)} días`;
  }

  // Cerrar al hacer clic fuera
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.usuarios-detalle-container')) {
      this.mostrarDetalle = false;
    }
  }
  async cargarPrivilegios() {
    try {

      // 1. Obtener sesión actual
      const session = await this.authService.getCurrentSession();

      if (!session?.user) {
        console.log('❌ No hay usuario autenticado');
        this.userPrivileges = [];
        return;
      }

      const userId = session.user.id;

      // 2. Obtener privilegios del servicio
      const privilegios = await this.usuariosService.getUserPrivilegesList(userId);

      // 3. GUARDAR EN LA VARIABLE
      this.userPrivileges = privilegios;


      // Opcional: Guardar también en localStorage para persistencia
      localStorage.setItem('user_privileges', JSON.stringify(this.userPrivileges));

    } catch (error) {
      console.error('💥 Error cargando privilegios:', error);
      this.userPrivileges = [];
    }
  }

  // Método para verificar si tiene un privilegio específico
  tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }

  // Método para obtener la lista de privilegios (por si necesitas usarla)
  obtenerPrivilegios(): string[] {
    return this.userPrivileges;
  }

  ngAfterViewInit(): void {
    this.checkScreenSize();
    this.setupEventListeners();
    this.setupResizeListener();
    this.setupRouterNavigationListener();

    // Agregar un pequeño delay para asegurar que el DOM está listo
    setTimeout(() => {
      this.setupNavItemsListeners();
    }, 100);
  }

  private setupRouterNavigationListener(): void {
    this.routerSubscription = this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd)
      )
      .subscribe(() => {
        this.closeSidenav();
      });
  }

  // Método público para poder usarlo desde el template si es necesario
  closeSidenav(): void {
    if (this.sidenavElement && this.sidenavElement.nativeElement) {
      if (!this.isLargeScreen) {
        // Para móviles: cerrar el menú deslizante
        this.renderer.removeClass(this.sidenavElement.nativeElement, this.SIDENAV_ACTIVE_CLASS);
        if (this.gridElement && this.gridElement.nativeElement) {
          this.renderer.removeClass(this.gridElement.nativeElement, this.GRID_NO_SCROLL_CLASS);
        }
      }
      // Opcional: Si quieres que también se cierre en pantallas grandes
      else {
        this.renderer.addClass(this.sidenavElement.nativeElement, this.SIDENAV_COLLAPSED_CLASS);
        if (this.gridElement && this.gridElement.nativeElement) {
          this.renderer.addClass(this.gridElement.nativeElement, this.GRID_COLLAPSED_CLASS);
        }
      }
    }
  }

  private checkScreenSize(): void {
    this.isLargeScreen = window.innerWidth > 750;

    if (this.isLargeScreen) {
      this.renderer.addClass(this.sidenavElement.nativeElement, this.SIDENAV_COLLAPSED_CLASS);
      this.renderer.addClass(this.gridElement.nativeElement, this.GRID_COLLAPSED_CLASS);
    } else {
      this.renderer.removeClass(this.sidenavElement.nativeElement, this.SIDENAV_ACTIVE_CLASS);
      this.renderer.removeClass(this.gridElement.nativeElement, this.GRID_NO_SCROLL_CLASS);
    }
  }

  private setupEventListeners(): void {
    // User dropdown - para ambos avatares
    const avatars = document.querySelectorAll('.header__avatar');
    avatars.forEach(avatar => {
      const listener = this.renderer.listen(avatar, 'click', (e) => {
        e.stopPropagation();

        avatars.forEach(otherAvatar => {
          if (otherAvatar !== avatar) {
            const otherDropdown = otherAvatar.querySelector('.dropdown');
            if (otherDropdown) {
              this.renderer.removeClass(otherDropdown, 'dropdown--active');
            }
          }
        });

        const dropdown = avatar.querySelector('.dropdown');
        this.toggleClassNative(dropdown, 'dropdown--active');
      });
      this.listeners.push(listener);
    });

    // Cerrar menús al hacer clic fuera
    const documentListener = this.renderer.listen('document', 'click', (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.header__avatar') && !target.closest('.dropdown')) {
        avatars.forEach(avatar => {
          const dropdown = avatar.querySelector('.dropdown');
          if (dropdown) {
            this.renderer.removeClass(dropdown, 'dropdown--active');
          }
        });
      }
    });
    this.listeners.push(documentListener);

    // Menu button
    const menuButton = document.querySelector('.header__menu');
    if (menuButton) {
      const listener = this.renderer.listen(menuButton, 'click', () => {
        if (this.isLargeScreen) {
          this.toggleClassNative(this.sidenavElement.nativeElement, this.SIDENAV_COLLAPSED_CLASS);
          this.toggleClassNative(this.gridElement.nativeElement, this.GRID_COLLAPSED_CLASS);
        } else {
          this.toggleClassNative(this.sidenavElement.nativeElement, this.SIDENAV_ACTIVE_CLASS);
          this.toggleClassNative(this.gridElement.nativeElement, this.GRID_NO_SCROLL_CLASS);
        }
      });
      this.listeners.push(listener);
    }

    // Sidenav close
    const closeButton = document.querySelector('.sidenav__brand-close');
    if (closeButton) {
      const listener = this.renderer.listen(closeButton, 'click', () => {
        this.closeSidenav();
      });
      this.listeners.push(listener);
    }

    
  }

  private setupNavItemsListeners(): void {
    // IMPORTANTE: Usar querySelectorAll en el sidenavElement para asegurar
    // que solo seleccionamos elementos dentro del menú lateral
    if (this.sidenavElement && this.sidenavElement.nativeElement) {
      const navItems = this.sidenavElement.nativeElement.querySelectorAll('.nav-item');

      navItems.forEach((item: Element) => {
        const listener = this.renderer.listen(item, 'click', (event) => {
          // Prevenir la propagación para evitar conflictos
          event.stopPropagation();
          this.closeSidenav();
        });
        this.listeners.push(listener);
      });
    }
  }

  private setupResizeListener(): void {
    const resizeListener = this.renderer.listen('window', 'resize', () => {
      const width = window.innerWidth;
      const wasLargeScreen = this.isLargeScreen;
      this.isLargeScreen = width > 750;

      if (wasLargeScreen !== this.isLargeScreen) {
        if (this.isLargeScreen) {
          this.sidenavElement.nativeElement.classList.remove(this.SIDENAV_ACTIVE_CLASS);
          this.gridElement.nativeElement.classList.remove(this.GRID_NO_SCROLL_CLASS);
          this.sidenavElement.nativeElement.classList.add(this.SIDENAV_COLLAPSED_CLASS);
          this.gridElement.nativeElement.classList.add(this.GRID_COLLAPSED_CLASS);
        } else {
          this.sidenavElement.nativeElement.classList.remove(this.SIDENAV_COLLAPSED_CLASS);
          this.sidenavElement.nativeElement.classList.remove(this.SIDENAV_ACTIVE_CLASS);
          this.gridElement.nativeElement.classList.remove(this.GRID_COLLAPSED_CLASS);
          this.gridElement.nativeElement.classList.remove(this.GRID_NO_SCROLL_CLASS);
        }
      }
    });
    this.listeners.push(resizeListener);
  }

  private toggleClassNative(element: any, className: string): void {
    if (element && element.classList) {
      element.classList.toggle(className);
    }
  }

  logout() {
    // Limpiar privilegios al cerrar sesión
    this.userPrivileges = [];
    localStorage.removeItem('user_privileges');

    this.authService.signOut();
    this.router.navigate(['/login']);
  }

  ngOnDestroy(): void {
    this.listeners.forEach(listener => listener());
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }
}