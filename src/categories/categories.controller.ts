// src/categories/categories.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** PÚBLICO: listado de categorías (lo usa la landing y la vista del estudiante). */
  @Public()
  @Get()
  async findAll() {
    return { success: true, data: await this.categories.findAll() };
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  async create(@Body() body: any) {
    return { success: true, data: await this.categories.create(body) };
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return { success: true, data: await this.categories.update(id, body) };
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(id);
  }
}
