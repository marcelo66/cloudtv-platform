import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { VideosModule } from './modules/videos/videos.module';
import { WorkerModule } from './modules/worker/worker.module';
import { StorageModule } from './modules/storage/storage.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PlaylistsModule } from './modules/playlists/playlists.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { PlayoutModule } from './modules/playout/playout.module';
import { OverlaysModule } from './modules/overlays/overlays.module';
import { StreamOutputsModule } from './modules/stream-outputs/stream-outputs.module';
import { AdBlocksModule } from './modules/ad-blocks/ad-blocks.module';
import { CuePointsModule } from './modules/cue-points/cue-points.module';
import { AdReportsModule } from './modules/ad-reports/ad-reports.module';
import { ZeroTierModule } from './modules/zerotier/zerotier.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { YoutubeAuthModule } from './modules/youtube-auth/youtube-auth.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    // Config global
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),

    // BullMQ con Redis
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD', 'redis_dev_password') || undefined,
        },
        defaultJobOptions: {
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      }),
    }),

    // Core
    PrismaModule,
    StorageModule,

    // Feature modules
    AuthModule,
    UsersModule,
    ChannelsModule,
    VideosModule,
    PlaylistsModule,
    SchedulesModule,
    PlayoutModule,
    OverlaysModule,
    StreamOutputsModule,
    AdBlocksModule,
    CuePointsModule,
    AdReportsModule,
    ZeroTierModule,
    IngestModule,
    YoutubeAuthModule,
    AdminModule,
    WorkerModule,
  ],
})
export class AppModule {}
