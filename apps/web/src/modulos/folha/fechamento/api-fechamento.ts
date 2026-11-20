// Cliente do fechamento do período da folha (M53.7, etapa F6): a lista dos fechamentos do ano, o detalhe, a prévia e o
// fechamento (com a data de pagamento da folha mensal) e a reabertura com motivo. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção); as respostas seguem os tipos de @sgh/contratos.
import type {
  FecharFolhaEntrada,
  FechamentoFolha,
  FiltroFechamentosFolha,
  ListaFechamentosFolha,
  ReabrirFolhaEntrada,
  ResultadoFechamentoFolha,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../../exames/api-exames.js';

const F = '/api/pessoas/folha/fechamentos';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export const lerFechamentos = (f: FiltroFechamentosFolha) =>
  ler(
    `${F}${qs({ empresa: f.empresa, apuracao: f.apuracao, ano: f.ano })}`,
    confiar<ListaFechamentosFolha>(),
  );
export const lerFechamento = (id: number) => ler(`${F}/${id}`, confiar<FechamentoFolha>());
export const fecharFolha = (e: FecharFolhaEntrada) =>
  enviar(
    F,
    e,
    confiar<ResultadoFechamentoFolha>(),
    novaChave(e.simular ? 'm53.fechamento.previa' : 'm53.fechamento'),
  );
export const reabrirFolha = (id: number, e: ReabrirFolhaEntrada) =>
  enviar(`${F}/${id}/reabertura`, e, confiar<FechamentoFolha>(), novaChave('m53.fechamento.reabertura'));
