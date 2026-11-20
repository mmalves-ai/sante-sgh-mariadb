// @Auditar (ficha do M06, regra 11; cap-08 §8.12): depois que o handler produz a resposta e ANTES de ela
// sair, o evento vai às trilhas; se a trilha falhar, a resposta não sai (503 trilha-indisponivel): "sem
// trilha, sem dado". A sessão vem da guarda (req.sgh); o alvo (paciente, atendimento, registro), do handler
// (req.sghAlvo), para a trilha do legado sair como o Delphi grava (ex.: pep.prontuario.lido com o paciente).
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, type Observable, switchMap } from 'rxjs';
import { ErroProblema } from '../problema.filter.js';
import { CHAVE_AUDITAR } from './decoradores.js';
import type { RequisicaoAutorizada } from './guarda.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from './estacao.js';
import { REGISTRADOR_TRILHA } from './simbolos.js';
import type { RegistradorTrilha } from './trilha.js';

export { REGISTRADOR_TRILHA };

@Injectable()
export class InterceptadorAuditoria implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {}

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const evento = this.reflector.getAllAndOverride<string>(CHAVE_AUDITAR, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!evento) return proximo.handle();
    const req = contexto.switchToHttp().getRequest<RequisicaoAutorizada>();
    return proximo.handle().pipe(
      switchMap((resposta) =>
        from(
          (async () => {
            const a = req.sgh;
            if (!a) throw new ErroProblema('trilha-indisponivel', 503, 'Trilha de auditoria indisponível');
            try {
              await this.trilha.registrar({
                evento,
                rede: a.sessao.rede ?? '',
                hospital: a.sessao.estabelecimentoAtivo ?? '',
                usuario: a.sessao.usuario.login ?? a.sessao.usuario.id,
                estacao: estacaoDaRequisicao(req),
                correlacao: correlacaoDaRequisicao(req, evento.slice(0, 64)),
                recurso: a.permissao.split('.').slice(0, 2).join('.'),
                resultado: 'sucesso',
                ...(req.sghAlvo ?? {}),
              });
            } catch {
              throw new ErroProblema(
                'trilha-indisponivel',
                503,
                'Trilha de auditoria indisponível',
                'A consulta não foi registrada; nada foi mostrado. Tente de novo em instantes.',
              );
            }
            return resposta;
          })(),
        ),
      ),
    );
  }
}
