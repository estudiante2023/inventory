import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Ubicacion } from './ubicacion';

describe('Ubicacion', () => {
  let component: Ubicacion;
  let fixture: ComponentFixture<Ubicacion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Ubicacion]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Ubicacion);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
