// src/categories/categories.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import { Course } from '../courses/course.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private repo: Repository<Category>,
    @InjectRepository(Course) private courseRepo: Repository<Course>,
  ) {}

  /** Lista las categorías activas con el número de cursos asociados. */
  async findAll() {
    const cats = await this.repo.find({ order: { nombre: 'ASC' } });
    const counts = await this.courseRepo
      .createQueryBuilder('c')
      .select('c.categoriaId', 'categoriaId')
      .addSelect('COUNT(*)', 'total')
      .where('c.categoriaId IS NOT NULL')
      .groupBy('c.categoriaId')
      .getRawMany();
    const map = new Map(counts.map((r) => [Number(r.categoriaId), Number(r.total)]));
    return cats.map((c) => ({ ...c, cursos: map.get(c.id) || 0 }));
  }

  async create(data: { nombre?: string; descripcion?: string; color?: string; icono?: string }) {
    const nombre = (data.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre de la categoría es obligatorio');
    const cat = this.repo.create({
      nombre,
      descripcion: (data.descripcion || '').trim() || null,
      color: (data.color || '').trim() || null,
      icono: (data.icono || '').trim() || null,
    });
    return this.repo.save(cat);
  }

  async update(id: number, data: any) {
    const cat = await this.repo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    if (data.nombre !== undefined) cat.nombre = String(data.nombre).trim() || cat.nombre;
    if (data.descripcion !== undefined) cat.descripcion = String(data.descripcion).trim() || null;
    if (data.color !== undefined) cat.color = String(data.color).trim() || null;
    if (data.icono !== undefined) cat.icono = String(data.icono).trim() || null;
    return this.repo.save(cat);
  }

  async remove(id: number) {
    const cat = await this.repo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    // Desasociar los cursos de esta categoría (no se borran los cursos)
    await this.courseRepo.update({ categoriaId: id }, { categoriaId: null });
    await this.repo.delete(id);
    return { success: true, message: 'Categoría eliminada' };
  }
}
