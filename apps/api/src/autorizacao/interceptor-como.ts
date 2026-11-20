// Interceptor do "login como" (ADR 0021). Na requisição de uma sessão "como" (req.sghComo, posto pela guarda):
// - escrita (POST, PUT, PATCH, DELETE): a linha da escrita (SGH_SUP_ACAO: método, caminho, status) é gravada
//   ANTES do handler; sem ela, a escrita não acontece (503, falha fechada). O handler roda marcado
//   (contextoComo do núcleo): toda escrita confirmada grava a imagem antes/depois na mesma transação e a
//   SGH_TRILHA leva o ator real na ORIGEM. No fim, o status (ok ou error) e o código HTTP;
// - leitura: agregada por caminho (nunca query string nem corpo).
// Não há lista de bloqueio: dentro do "como" vale o que o alvo pode (decisão do dono, 20/10/2026).
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { executarComo } from '@sgh/legado';
import { Observable } from 'rxjs';
import { ErroProblema } from '../problema.filter.js';
import { caminhoAuditado, type ServicoComo } from '../modulos/suporte/servico-como.js';
import type { RequisicaoAutorizada } from './guarda.js';
import { AUDITORIA_COMO } from './simbolos.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CHAVE_HTTP_CODE = '__httpCode__';

@Injectable()
export class InterceptadorComo implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUDITORIA_COMO) private readonly como: ServicoComo | null,
  ) {}

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const req = contexto.switchToHttp().getRequest<RequisicaoAutorizada>();
    const c = req.sghComo;
    if (!c || !this.como) return proximo.handle();
    const servico = this.como;
    const metodo = (req.method ?? 'GET').toUpperCase();
    const caminho = caminhoAuditado(req.url);
    const marca = { sessao: c.sessao, atorTipo: c.atorTipo, idConta: c.idConta, alvo: c.alvoLogin };
    if (METODOS_SEGUROS.has(metodo)) {
      servico.leitura(c, caminho);
      return new Observable((sub) =>
        executarComo({ ...marca, acao: null }, () => proximo.handle().subscribe(sub)),
      );
    }
    const codigoOk =
      this.reflector.get<number | undefined>(CHAVE_HTTP_CODE, contexto.getHandler()) ??
      (metodo === 'POST' ? 201 : 200);
    return new Observable((sub) => {
      let encerrado = false;
      let inscricao: { unsubscribe(): void } | null = null;
      servico.registrarEscrita(c, metodo, caminho).then(
        (idAcao) => {
          if (encerrado) return;
          inscricao = executarComo({ ...marca, acao: idAcao }, () =>
            proximo.handle().subscribe({
              next: (v) => sub.next(v),
              error: (e: unknown) => {
                const http = e instanceof HttpException ? e.getStatus() : 500;
                void servico.finalizarEscrita(idAcao, 'error', http).finally(() => sub.error(e));
              },
              complete: () => {
                void servico.finalizarEscrita(idAcao, 'ok', codigoOk).finally(() => sub.complete());
              },
            }),
          );
        },
        () =>
          sub.error(
            new ErroProblema(
              'trilha-indisponivel',
              503,
              'Auditoria do suporte técnico indisponível',
              'A escrita não aconteceu porque não pôde ser registrada; tente de novo em instantes.',
            ),
          ),
      );
      return () => {
        encerrado = true;
        inscricao?.unsubscribe();
      };
    });
  }
}
