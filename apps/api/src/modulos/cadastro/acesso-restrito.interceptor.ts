// Filtro comum do paciente com acesso restrito (F8, 02-CAD linha 10) nas leituras e gravações clínicas de todos os
// módulos: prontuário (PEP), enfermagem, SADT, internação (internacao/*, internacoes, documentos-internacao), cirurgia,
// farmácia e nutrição. O paciente sai do parâmetro da rota, da consulta ou (nas gravações) do corpo: o paciente direto
// (`p`, `paciente`...) ou um recurso que leva a ele (atendimento, internação, agendamento e ato cirúrgico), pelas chaves
// comuns ou pelo resolvedor declarado da rota (RESOLVEDORES_DE_ROTA); depois do método, o paciente que a rota declarou
// para a trilha (req.sghAlvo) também é conferido antes de a resposta sair. Toda rota assim passa
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
import { PATH_METADATA } from '@nestjs/common/constants';
import { from, type Observable, of, switchMap } from 'rxjs';
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

/** Módulos clínicos cujas rotas por paciente passam pelo filtro (prefixo do controller). */
export const MODULOS_CLINICOS_RESTRITOS = [
  'pep',
  'enfermagem',
  'sadt',
  'internacao',
  'internacoes',
  'documentos-internacao',
  'cirurgia',
  'farmacia',
  'nutricao',
] as const;
// O prefixo global é /api; os controllers declarados com 'api/sadt/...' ficam em /api/api/sadt (também cobertos).
const CAMINHO_CLINICO = new RegExp(`^/api/(?:api/)?(?:${MODULOS_CLINICOS_RESTRITOS.join('|')})(?:/|$)`);

/** O que identifica o paciente na rota: ele mesmo ou um recurso clínico que tem o paciente. */
export type RecursoPaciente = 'atendimento' | 'internacao' | 'agendamento-cirurgico' | 'ato-cirurgico';
/** Parâmetros (rota, consulta e corpo) com o mesmo sentido em todas as rotas clínicas. */
export const CHAVES_ALVO: Readonly<Record<string, 'paciente' | RecursoPaciente>> = {
  p: 'paciente',
  paciente: 'paciente',
  idPaciente: 'paciente',
  pacienteId: 'paciente',
  atendimento: 'atendimento',
  idAtendimento: 'atendimento',
  atendimentoId: 'atendimento',
  atd: 'atendimento',
  internacao: 'internacao',
  internacaoId: 'internacao',
  int: 'internacao',
  agenda: 'agendamento-cirurgico',
  agendamentoCirurgico: 'agendamento-cirurgico',
  ato: 'ato-cirurgico',
  atoCirurgico: 'ato-cirurgico',
};
/** Resolvedor declarado por rota: o parâmetro genérico (:id, :reg) que, nesta rota, é um recurso com paciente. */
export const RESOLVEDORES_DE_ROTA: readonly { rota: RegExp; param: string; recurso: RecursoPaciente }[] = [
  { rota: /^\/api\/internacoes\/:reg(?:\/|$)/, param: 'reg', recurso: 'internacao' },
  { rota: /^\/api\/documentos-internacao\/internacao\/:reg(?:\/|$)/, param: 'reg', recurso: 'internacao' },
  { rota: /^\/api\/cirurgia\/agendamentos\/:id(?:\/|$)/, param: 'id', recurso: 'agendamento-cirurgico' },
  { rota: /^\/api\/cirurgia\/atos\/:id(?:\/|$)/, param: 'id', recurso: 'ato-cirurgico' },
];

export interface AlvoRequisicao {
  paciente: number | null;
  recurso: { tipo: RecursoPaciente; id: number } | null;
}

const idValido = (v: unknown): number | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^\d{1,15}$/.test(s) && Number(s) > 0
    ? Number(s)
    : typeof s === 'number' && Number.isSafeInteger(s) && s > 0
      ? s
      : null;
};

/**
 * O paciente (ou o recurso que leva a ele) que a requisição traz: pelo resolvedor declarado da rota, pelos parâmetros
 * da rota, pela consulta e, nas gravações, pelo corpo. O paciente direto vence o recurso.
 */
export function alvoDaRequisicao(req: {
  rota?: string;
  method?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}): AlvoRequisicao {
  const corpo =
    req.method && req.method !== 'GET' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const fontes = [req.params ?? {}, req.query ?? {}, corpo];
  let recurso: AlvoRequisicao['recurso'] = null;
  for (const r of RESOLVEDORES_DE_ROTA)
    if (req.rota && r.rota.test(req.rota)) {
      const v = idValido(req.params?.[r.param]);
      if (v !== null) recurso = { tipo: r.recurso, id: v };
    }
  for (const f of fontes)
    for (const [k, tipo] of Object.entries(CHAVES_ALVO)) {
      const v = idValido(f[k]);
      if (v === null) continue;
      if (tipo === 'paciente') return { paciente: v, recurso: null };
      recurso ??= { tipo, id: v };
    }
  return { paciente: null, recurso };
}

const juntar = (...partes: unknown[]): string =>
  `/${partes
    .flatMap((x) => (Array.isArray(x) ? x.slice(0, 1) : [x]))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => x.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

/** O modelo da rota (com o prefixo global), pelos metadados do controller e do método. */
export function rotaDoContexto(contexto: ExecutionContext): string | null {
  try {
    const c = Reflect.getMetadata(PATH_METADATA, contexto.getClass()) as unknown;
    const h = Reflect.getMetadata(PATH_METADATA, contexto.getHandler()) as unknown;
    return c === undefined && h === undefined ? null : juntar('api', c, h);
  } catch {
    return null;
  }
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
    const req = contexto
      .switchToHttp()
      .getRequest<RequisicaoAutorizada & { originalUrl?: string; route?: { path?: unknown } }>();
    const a = req.sgh;
    const rota = rotaDoContexto(contexto) ?? (typeof req.route?.path === 'string' ? req.route.path : null);
    if (!a || !caminhoClinico(rota ?? req.originalUrl ?? req.url ?? '')) return proximo.handle();
    const alvo = alvoDaRequisicao({
      ...(req as unknown as Parameters<typeof alvoDaRequisicao>[0]),
      rota: rota ?? '',
    });
    const antes =
      alvo.paciente === null && alvo.recurso === null ? Promise.resolve(null) : this.conferir(req, alvo);
    // Depois do método: o paciente que a própria rota declarou para a trilha (req.sghAlvo) passa pela mesma decisão,
    // o que cobre a leitura por um id que só o serviço resolve; negado, a resposta não sai.
    return from(antes).pipe(
      switchMap((conferido) =>
        proximo.handle().pipe(
          switchMap((resposta) => {
            const depois = idValido(req.sghAlvo?.paciente);
            return depois === null || depois === conferido
              ? of(resposta)
              : from(this.conferir(req, { paciente: depois, recurso: null }).then(() => resposta));
          }),
        ),
      ),
    );
  }

  /** Decide pelo paciente do alvo; devolve o paciente conferido (null: o recurso não leva a paciente nenhum). */
  private async conferir(req: RequisicaoAutorizada, alvo: AlvoRequisicao): Promise<number | null> {
    const a = req.sgh!;
    const porta = this.porta!;
    let decisao: DecisaoRestrito;
    let paciente = alvo.paciente;
    try {
      if (paciente === null && alvo.recurso !== null)
        paciente = await porta.pacienteDoRecurso(alvo.recurso.tipo, alvo.recurso.id);
      if (paciente === null) return null;
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
    if (acessoRestritoPermite(decisao.desfecho)) return paciente;
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
