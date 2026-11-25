// Filtro comum do paciente com acesso restrito (F8, 02-CAD linha 10) nas leituras e gravações clínicas de todos os
// módulos: prontuário (PEP), enfermagem, SADT, internação, cirurgia, farmácia e nutrição. Toda rota desses módulos que
// traz o paciente (parâmetro ou consulta `paciente`, `idPaciente`, `pacienteId`) ou o atendimento (`atendimento`) passa
// pela decisão do domínio (decidirAcessoRestrito): com marca viva, só o liberado nominal, quem atende o paciente agora ou
// a quebra de vidro vigente; o resto recebe 403 `sem-vinculo` com o código `paciente-restrito` (com a oferta da quebra de vidro quando a marca a
// admite) e a tentativa vai à trilha. Falha fechada: sem poder decidir (banco fora), 503 e nada mostrado.
// Sem marca no paciente (o caso comum), uma só leitura indexada. Rotas sem paciente (catálogos, listas gerais) seguem.
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { acessoRestritoPermite } from '@sgh/dominio-cadastro';
import { from, type Observable, switchMap } from 'rxjs';
import { REGISTRADOR_TRILHA } from '../../autorizacao/auditoria.interceptor.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  ACESSO_RESTRITO,
  type AcessoRestritoProprio,
  type DecisaoRestrito,
} from './acesso-restrito-proprio.js';

/** Módulos clínicos cujas rotas por paciente passam pelo filtro. */
export const MODULOS_CLINICOS_RESTRITOS = [
  'pep',
  'enfermagem',
  'sadt',
  'internacao',
  'cirurgia',
  'farmacia',
  'nutricao',
] as const;
const CAMINHO_CLINICO = new RegExp(`^/api/(?:${MODULOS_CLINICOS_RESTRITOS.join('|')})(?:/|$)`);
const CHAVES_PACIENTE = ['paciente', 'idPaciente', 'pacienteId'] as const;
const CHAVES_ATENDIMENTO = ['atendimento', 'idAtendimento', 'atendimentoId'] as const;

const idValido = (v: unknown): number | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^\d{1,15}$/.test(s) && Number(s) > 0
    ? Number(s)
    : typeof s === 'number' && Number.isSafeInteger(s) && s > 0
      ? s
      : null;
};

/** O paciente ou o atendimento que a rota traz (parâmetro da rota antes da consulta). */
export function alvoDaRequisicao(req: {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): { paciente: number | null; atendimento: number | null } {
  const fontes = [req.params ?? {}, req.query ?? {}];
  for (const f of fontes)
    for (const k of CHAVES_PACIENTE) {
      const v = idValido(f[k]);
      if (v !== null) return { paciente: v, atendimento: null };
    }
  for (const f of fontes)
    for (const k of CHAVES_ATENDIMENTO) {
      const v = idValido(f[k]);
      if (v !== null) return { paciente: null, atendimento: v };
    }
  return { paciente: null, atendimento: null };
}

export const caminhoClinico = (url: string): boolean => CAMINHO_CLINICO.test(url.split('?')[0] ?? '');

@Injectable()
export class InterceptadorAcessoRestrito implements NestInterceptor {
  constructor(
    @Optional() @Inject(ACESSO_RESTRITO) private readonly porta: AcessoRestritoProprio | null = null,
    @Optional() @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha | null = null,
  ) {}

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    if (contexto.getType() !== 'http' || !this.porta) return proximo.handle();
    const req = contexto.switchToHttp().getRequest<RequisicaoAutorizada & { originalUrl?: string }>();
    const a = req.sgh;
    if (!a || !caminhoClinico(req.originalUrl ?? req.url ?? '')) return proximo.handle();
    const alvo = alvoDaRequisicao(req as unknown as Parameters<typeof alvoDaRequisicao>[0]);
    if (alvo.paciente === null && alvo.atendimento === null) return proximo.handle();
    return from(this.conferir(req, alvo)).pipe(switchMap(() => proximo.handle()));
  }

  private async conferir(
    req: RequisicaoAutorizada,
    alvo: { paciente: number | null; atendimento: number | null },
  ): Promise<void> {
    const a = req.sgh!;
    const porta = this.porta!;
    let decisao: DecisaoRestrito;
    let paciente = alvo.paciente;
    try {
      if (paciente === null && alvo.atendimento !== null)
        paciente = await porta.pacienteDoAtendimento(alvo.atendimento);
      if (paciente === null) return;
      decisao = await porta.decidir({
        hospital: a.sessao.estabelecimentoAtivo ?? '',
        login: a.sessao.usuario.login ?? a.sessao.usuario.id,
        paciente,
        plataforma: a.sessao.usuario.ator === 'plataforma',
      });
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Acesso restrito não conferido',
        'Não foi possível conferir a restrição de acesso do paciente; nada foi mostrado.',
      );
    }
    if (acessoRestritoPermite(decisao.desfecho)) return;
    await this.trilha
      ?.registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede: a.sessao.rede ?? '',
        hospital: a.sessao.estabelecimentoAtivo ?? '',
        usuario: a.sessao.usuario.login ?? a.sessao.usuario.id,
        estacao: estacaoDaRequisicao(req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(req, 'paciente-restrito').slice(0, 64),
        recurso: 'cadastro.acessoRestrito',
        resultado: 'falha',
        paciente,
        tabelaAlvo: 'paciente_acesso_restrito',
        idAlvo: String(decisao.marcas[0] ?? paciente),
        chaveNaturalAlvo: `paciente-restrito:${decisao.desfecho}`,
      })
      .catch(() => undefined);
    // O tipo é o da falta de vínculo: a tela do prontuário já oferece a quebra de vidro nele; o código distingue.
    throw new ErroProblema(
      'sem-vinculo',
      403,
      'Paciente com acesso restrito',
      decisao.desfecho === 'quebra-de-vidro'
        ? 'O prontuário deste paciente só abre para os profissionais liberados e para quem o atende agora. Em emergência, use a quebra de vidro.'
        : 'O prontuário deste paciente só abre para os profissionais liberados e para quem o atende agora.',
      { quebraDeVidro: decisao.desfecho === 'quebra-de-vidro', codigo: 'paciente-restrito' },
    );
  }
}
