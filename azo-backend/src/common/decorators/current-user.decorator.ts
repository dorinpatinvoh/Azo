import { createParamDecorator, ExecutionContext } from "@nestjs/common";

// Usage : someRoute(@CurrentUser() user) -> { userId, role, phone }
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
