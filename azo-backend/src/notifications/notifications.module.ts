import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

type PushOptions = {
  /** Send an OS-level notification through Expo Push Service as well as saving it in-app. */
  sendPush?: boolean;
  data?: Record<string, string | number | boolean | null>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // Save every notification in the inbox. Callers opt in to an OS push when it is urgent.
  async push(userId: string, title: string, body: string, type: string, options: PushOptions = {}) {
    const notification = await this.prisma.notification.create({
      data: { userId, title, body, type },
    });

    if (options.sendPush) {
      await this.sendExpoPush(userId, title, body, options.data);
    }

    return notification;
  }

  async registerPushToken(userId: string, token: string, platform?: string) {
    // Expo tokens are opaque, but this prevents arbitrary strings from being sent upstream.
    if (!/^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token)) {
      throw new BadRequestException("Jeton de notification Expo invalide");
    }

    await this.prisma.devicePushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
    return { registered: true };
  }

  async unregisterPushToken(userId: string, token: string) {
    const result = await this.prisma.devicePushToken.deleteMany({ where: { userId, token } });
    return { unregistered: result.count > 0 };
  }

  private async sendExpoPush(
    userId: string,
    title: string,
    body: string,
    data?: PushOptions["data"]
  ) {
    let devices: { token: string }[];
    try {
      devices = await this.prisma.devicePushToken.findMany({
        where: { userId },
        select: { token: true },
      });
    } catch (error) {
      this.logger.warn(`Expo Push tokens unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      return;
    }
    if (devices.length === 0) return;

    const endpoint = "https://exp.host/--/api/v2/push/send";
    const batchSize = 100;

    for (let start = 0; start < devices.length; start += batchSize) {
      const batch = devices.slice(start, start + batchSize);
      const messages = batch.map(({ token }) => ({
        to: token,
        title,
        body,
        sound: "default",
        priority: "high",
        channelId: "default",
        ...(data ? { data } : {}),
      }));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messages),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          this.logger.warn(`Expo Push API HTTP ${response.status} (${batch.length} destination(s))`);
          continue;
        }

        const tickets = Array.isArray(result?.data) ? result.data : [];
        const invalidTokens = tickets.flatMap((ticket: any, index: number) =>
          ticket?.status === "error" &&
          ticket?.details?.error === "DeviceNotRegistered" &&
          batch[index]
            ? [batch[index].token]
            : []
        );
        if (invalidTokens.length > 0) {
          await this.prisma.devicePushToken.deleteMany({ where: { token: { in: invalidTokens } } });
        }

        const failures = tickets.filter((ticket: any) => ticket?.status === "error").length;
        if (failures > 0) {
          this.logger.warn(`Expo Push API returned ${failures} failed ticket(s)`);
        }
      } catch (error) {
        // Push delivery is best-effort: the in-app inbox and Socket.IO status remain available.
        this.logger.warn(`Expo Push API unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  }
}

class PushTokenDto {
  @IsString()
  @MaxLength(512)
  token: string;

  @IsOptional()
  @IsString()
  @IsIn(["android", "ios"])
  platform?: string;
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user) {
    return this.svc.list(user.userId);
  }

  @Post("read-all")
  readAll(@CurrentUser() user) {
    return this.svc.markAllRead(user.userId);
  }

  @Post("push-token")
  registerPushToken(@CurrentUser() user, @Body() dto: PushTokenDto) {
    return this.svc.registerPushToken(user.userId, dto.token, dto.platform);
  }

  @Post("push-token/unregister")
  unregisterPushToken(@CurrentUser() user, @Body() dto: PushTokenDto) {
    return this.svc.unregisterPushToken(user.userId, dto.token);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
