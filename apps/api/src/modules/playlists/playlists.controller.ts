import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { AddItemDto } from './dto/add-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('playlists')
@UseGuards(JwtAuthGuard)
export class PlaylistsController {
  constructor(private readonly service: PlaylistsService) {}

  @Post()
  create(@Body() dto: CreatePlaylistDto, @Req() req: any) {
    return this.service.create(dto, req.user.id);
  }

  @Get()
  findAll(@Query('channelId') channelId: string, @Req() req: any) {
    return this.service.findAll(channelId, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlaylistDto, @Req() req: any) {
    return this.service.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.id);
  }

  // ─── Items ────────────────────────────────────────────────────

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto, @Req() req: any) {
    return this.service.addItem(id, dto, req.user.id);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Req() req: any,
  ) {
    return this.service.removeItem(id, itemId, req.user.id);
  }

  @Patch(':id/items/reorder')
  reorderItems(
    @Param('id') id: string,
    @Body() dto: ReorderItemsDto,
    @Req() req: any,
  ) {
    return this.service.reorderItems(id, dto, req.user.id);
  }
}
