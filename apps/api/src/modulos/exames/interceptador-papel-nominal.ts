// Põe o papel da sessão (02-AGE linha 40: gestor da agenda de exames e administrador da plataforma) no contexto da
// requisição da agenda de exames, para a trava e a leitura da lista nominal (papel-nominal.ts). O gestor é o cargo
// com a manutenção da agenda de exames: vê a agenda restrita e a mantém, mas só marca se estiver na lista.
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { sessaoDe } from '../cadastro/comum.js';
import { comPapelNominal } from './papel-nominal.js';

/** Permissão do cargo que mantém a agenda de exames (o gestor da lista nominal). */
export const PERMISSAO_GESTOR_AGENDA_EXAME = 'agenda.agendaExame.editar';

@Injectable()
export class InterceptadorPapelNominal implements NestInterceptor {
  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const req = contexto.switchToHttp().getRequest<RequisicaoAutorizada>();
    if (!req.sgh) return proximo.handle();
    const papel = {
      gestor: sessaoDe(req).pode(PERMISSAO_GESTOR_AGENDA_EXAME),
      administrador: req.sgh.sessao.usuario.ator === 'plataforma',
    };
    return new Observable((sub) => comPapelNominal(papel, () => proximo.handle().subscribe(sub)));
  }
}
