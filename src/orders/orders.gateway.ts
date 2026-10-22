import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';

type JoinBody = { orderId?: unknown };

@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private subscription?: Subscription;

  constructor(
    private readonly orders: OrdersService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  afterInit(server: Server): void {
    this.subscription = this.orderEvents.events$.subscribe((event) => {
      server.to(OrderEventsService.room(event.orderId)).emit('order.status', event);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinBody,
  ): Promise<{ ok: boolean; room?: string }> {
    const orderId = Number(body?.orderId);
    const userId = Number((client.handshake.auth as { userId?: unknown } | undefined)?.userId);
    if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(userId) || userId < 1) {
      return { ok: false };
    }
    const ownerId = await this.orders.ownerId(orderId);
    if (ownerId === null || ownerId !== String(userId)) {
      return { ok: false };
    }
    const room = OrderEventsService.room(orderId);
    await client.join(room);
    return { ok: true, room };
  }
}
