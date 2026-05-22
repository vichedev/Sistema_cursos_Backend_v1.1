// src/campaigns/campaigns.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  ParseIntPipe,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

const imageUploadOptions = {
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 MB
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new BadRequestException('Solo se permiten imágenes JPEG, PNG, WebP o GIF'), false);
    }
    cb(null, true);
  },
};

@Controller('campaigns')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  async findAll() {
    return { success: true, data: await this.campaigns.findAll() };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.campaigns.getDetail(id) };
  }

  /** Crea una campaña. Acepta hasta 5 imágenes y, si enviarAhora=true, la lanza. */
  @Post()
  @UseInterceptors(FilesInterceptor('imagenes', 5, imageUploadOptions))
  async create(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: any,
  ) {
    const imagenes = (files || []).map((f) => f.filename);
    const campaign = await this.campaigns.create(body, imagenes, req.user?.userId);

    if (body.enviarAhora === 'true' || body.enviarAhora === true) {
      await this.campaigns.send(campaign.id);
    }
    return { success: true, data: campaign, message: 'Campaña creada correctamente' };
  }

  @Post(':id/send')
  async send(@Param('id', ParseIntPipe) id: number) {
    return { success: true, ...(await this.campaigns.send(id)) };
  }

  @Post(':id/pause')
  async pause(@Param('id', ParseIntPipe) id: number) {
    return { success: true, ...(await this.campaigns.pause(id)) };
  }

  @Post(':id/resume')
  async resume(@Param('id', ParseIntPipe) id: number) {
    return { success: true, ...(await this.campaigns.resume(id)) };
  }

  @Post(':id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    return { success: true, ...(await this.campaigns.cancel(id)) };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.campaigns.remove(id);
    return { success: true, message: 'Campaña eliminada' };
  }
}
