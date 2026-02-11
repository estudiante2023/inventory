import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Loguin } from './loguin';

describe('Loguin', () => {
  let component: Loguin;
  let fixture: ComponentFixture<Loguin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Loguin]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Loguin);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
