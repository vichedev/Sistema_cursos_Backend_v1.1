// src/notifications/notifications.sse.service.ts
import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type SseEvent =
  | { type: 'COURSE_NOTIFY_START'; courseId: number; total: number; title: string }
  | { type: 'COURSE_NOTIFY_PROGRESS'; courseId: number; completed: number; total: number }
  | { type: 'COURSE_NOTIFY_DONE'; courseId: number }
  | { type: 'NEW_COURSE'; courseId: number; titulo: string; tipo: string; precio: number; imagen: string | null }
  | { type: 'DIPLOMA_GENERATED'; estudianteId: number; courseId: number; titulo: string; codigo: string; nombres: string };

@Injectable()
export class NotificationsSseService {
  private stream$ = new Subject<MessageEvent>();
  // estado opcional para evitar START duplicados y conocer último progreso
  private state = new Map<number, { title: string; completed: number; total: number }>();

  // Observable que usa el controller para `@Sse()`
  get stream() {
    return this.stream$.asObservable();
  }

  // Emisor genérico (compatibilidad)
  emit(payload: SseEvent) {
    this.applyState(payload);
    this.stream$.next({ data: payload } as MessageEvent);
  }

  // Helpers semánticos
  emitStart(courseId: number, title: string, total: number) {
    const id = Number(courseId);
    const prev = this.state.get(id);
    if (!prev) {
      this.state.set(id, { title, completed: 0, total });
      this.stream$.next(
        { data: { type: 'COURSE_NOTIFY_START', courseId: id, title, total } } as MessageEvent,
      );
    } else {
      // si ya existía, avisa progreso actual
      this.stream$.next(
        {
          data: {
            type: 'COURSE_NOTIFY_PROGRESS',
            courseId: id,
            completed: prev.completed,
            total: prev.total,
          },
        } as MessageEvent,
      );
    }
  }

  emitProgress(courseId: number, completed: number, total?: number) {
    const id = Number(courseId);
    const prev = this.state.get(id) || { title: '', completed: 0, total: total ?? 0 };
    const next = { ...prev, completed, total: total ?? prev.total };
    this.state.set(id, next);

    this.stream$.next(
      {
        data: {
          type: 'COURSE_NOTIFY_PROGRESS',
          courseId: id,
          completed: next.completed,
          total: next.total,
        },
      } as MessageEvent,
    );
  }

  emitDiplomaGenerated(estudianteId: number, courseId: number, titulo: string, codigo: string, nombres: string) {
    this.stream$.next({
      data: { type: 'DIPLOMA_GENERATED', estudianteId: Number(estudianteId), courseId: Number(courseId), titulo, codigo, nombres },
    } as MessageEvent);
  }

  emitNewCourse(courseId: number, titulo: string, tipo: string, precio: number, imagen: string | null = null) {
    this.stream$.next({
      data: { type: 'NEW_COURSE', courseId: Number(courseId), titulo, tipo, precio: parseFloat(String(precio)), imagen },
    } as MessageEvent);
  }

  emitDone(courseId: number) {
    const id = Number(courseId);
    const prev = this.state.get(id);
    if (prev) this.state.set(id, { ...prev, completed: prev.total });

    this.stream$.next(
      { data: { type: 'COURSE_NOTIFY_DONE', courseId: id } } as MessageEvent,
    );
  }

  // Mantiene el estado también cuando se usa emit() directo
  private applyState(payload: SseEvent) {
    const id = Number(payload.courseId);
    if (payload.type === 'COURSE_NOTIFY_START') {
      if (!this.state.has(id)) {
        this.state.set(id, { title: payload.title, completed: 0, total: payload.total });
      }
    } else if (payload.type === 'COURSE_NOTIFY_PROGRESS') {
      const prev = this.state.get(id) || { title: '', completed: 0, total: payload.total };
      this.state.set(id, {
        ...prev,
        completed: payload.completed,
        total: payload.total ?? prev.total,
      });
    } else if (payload.type === 'COURSE_NOTIFY_DONE') {
      const prev = this.state.get(id);
      if (prev) this.state.set(id, { ...prev, completed: prev.total });
    }
  }
}
