import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { MessagesService } from "./messages.service";

class ConversationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@Controller("messages")
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messages: MessagesService) {}

  /** 2.2.3 — Liste des conversations */
  @Get("conversations")
  getConversations(@CurrentUser() user, @Query() query: ConversationsQueryDto) {
    return this.messages.getConversations(user.userId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** 2.2.5 — Compteur de non-lus (pastille de l'onglet) */
  @Get("unread-count")
  getUnreadCount(@CurrentUser() user) {
    return this.messages.getUnreadCount(user.userId);
  }
}
