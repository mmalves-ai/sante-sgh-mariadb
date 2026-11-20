// W1-01 (parte 11c; mercado k "identidade única na rede e gestão central de acessos"; NGS1.03.09 c,e):
//   POST /api/administracao/acesso/rede-cpf            painel: a pessoa (CPF, ou login deste estabelecimento) em cada
//                                                       estabelecimento da rede, com contas, grupo e perfis
//   POST /api/administracao/acesso/rede-cpf/bloquear   "bloquear em todos": acesso.bloquearUsuario pelo executor, banco
//                                                       a banco, em cada conta ativa ainda não bloqueada
// Regras: só a rede da sessão (lista configurada; ARQ-1, regra 12) e cada leitura/gravação no banco de UM
// estabelecimento (nenhuma consulta cruza bancos). O CPF vai no corpo (nunca na URL) e não volta na resposta. O
// bloqueio pede a senha (reautenticação; regra 8) e o motivo; ninguém bloqueia a si mesmo (regra 7); em cada
// estabelecimento vale a regra do último gestor de acessos e a conta de aparelho fica de fora (bloqueio pela ficha). O
// resultado é por conta: o banco que não responde ou a recusa de um não desfaz os outros (cada receita é uma
// transação; a tela mostra o que ficou de fora para repetir).
import { createHash } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import {
  esquemaAlvoRedeCpf,
  esquemaBloquearRedeCpf,
  EVENTOS_AUDITAVEIS,
  type PainelRedeCpf,
  PERMISSOES_M10_CODIGOS,
  type ResultadoBloqueioRedeCpf,
} from '@sgh/contratos';
import { chaveGrupo, conferirGestao, GRUPOS_SEM_CPF, mensagemRecusaGestao } from '@sgh/dominio-acesso';
import { ErroIsolamentoRede, estabelecimentosDaRede } from '@sgh/dominio-rede';
import type { ContaRedeLegado } from '@sgh/legado';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { FONTE_GESTAO } from '../acesso/gestao-fonte.js';
import { exigirGestorRestante, type LeitorGestores } from '../acesso/ultimo-gestor.js';
import {
  analisar,
  contextoOperacao,
  ctxDe,
  idempotencia,
  problema,
  reautenticado,
  semSegredos,
  sessaoDe,
} from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

const C = PERMISSOES_M10_CODIGOS;
const ORIGEM = 'acesso-rede-cpf';

interface Lido {
  readonly codigo: string;
  readonly nome: string;
  readonly contas: ContaRedeLegado[] | null;
}

const alcancavel = (c: ContaRedeLegado) => c.ativo && !c.bloqueado;
const deAparelho = (c: ContaRedeLegado) =>
  GRUPOS_SEM_CPF.some((g) => chaveGrupo(g) === chaveGrupo(c.grupo ?? ''));

/** Chave de idempotência de cada receita do lote: a do pedido + estabelecimento + login (formato do executor). */
export function chaveDoItem(chave: string, hospital: string, login: string): string {
  return `rc-${createHash('sha256').update(`${chave}|${hospital}|${login}`).digest('hex').slice(0, 40)}`;
}

@Controller('administracao/acesso')
export class RedeCpfController {
  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_GESTAO) private readonly gestores: LeitorGestores | null = null,
  ) {}

  /** Regra 12: os estabelecimentos da rede da sessão, recusado antes de qualquer leitura. */
  private daRede(req: RequisicaoAutorizada): { codigo: string; nome: string }[] {
    const s = sessaoDe(req);
    const r = this.fonte.redeDoAcesso(ctxDe(req, ORIGEM));
    let codigos: readonly string[];
    try {
      codigos = estabelecimentosDaRede({
        redeSessao: s.rede,
        redeConfigurada: r.rede,
        estabelecimentos: r.estabelecimentos.map((e) => e.codigo),
      });
    } catch (e) {
      if (e instanceof ErroIsolamentoRede)
        throw new ErroProblema('sem-permissao', 403, 'Fora da rede', e.message, { codigo: e.codigo });
      throw e;
    }
    if (!codigos.includes(s.hospital))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora da rede',
        'O estabelecimento da sessão não é um estabelecimento desta rede.',
        { codigo: 'fora-da-rede' },
      );
    const nomes = new Map(r.estabelecimentos.map((e) => [e.codigo, e.nome]));
    // O estabelecimento da sessão primeiro; os outros em ordem de código.
    return [s.hospital, ...codigos.filter((c) => c !== s.hospital)].map((codigo) => ({
      codigo,
      nome: nomes.get(codigo) ?? codigo,
    }));
  }

  /** O CPF do pedido (ou o do login, lido no banco da sessão); null quando o login não tem CPF. */
  private async cpfDoAlvo(req: RequisicaoAutorizada, corpo: unknown): Promise<string> {
    const a = analisar(esquemaAlvoRedeCpf, corpo);
    if (a.cpf) return a.cpf.replace(/\D/g, '');
    const login = a.login!.toUpperCase();
    const f = await this.fonte
      .fichaUsuario(ctxDe(req, ORIGEM), login, false, { cpf: true })
      .catch((e: unknown) => problema(e));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    if (!f.cpf)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Usuário sem CPF',
        'O login não tem CPF: informe o CPF na ficha (com justificativa) para ver a pessoa na rede.',
        { codigo: 'sem-cpf' },
      );
    return f.cpf;
  }

  private async lerRede(req: RequisicaoAutorizada, cpf: string): Promise<Lido[]> {
    const s = sessaoDe(req);
    const ests = this.daRede(req);
    return Promise.all(
      ests.map(async (e) => ({
        ...e,
        contas: await this.fonte
          .contasDoCpf({ rede: s.rede, hospital: e.codigo, traceId: ctxDe(req, ORIGEM).traceId }, cpf)
          .catch(() => null),
      })),
    );
  }

  @Post('rede-cpf')
  @HttpCode(200)
  @Permissao(C.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.usuarioConsultado.codigo)
  async painel(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<PainelRedeCpf> {
    const cpf = await this.cpfDoAlvo(req, corpo);
    const lidos = await this.lerRede(req, cpf);
    const contas = lidos.flatMap((l) => l.contas ?? []);
    return semSegredos({
      estabelecimentos: lidos.map((l) => ({
        codigo: l.codigo,
        nome: l.nome,
        situacao: l.contas ? ('lido' as const) : ('indisponivel' as const),
        contas: l.contas ?? [],
      })),
      totalContas: contas.length,
      aBloquear: contas.filter((c) => alcancavel(c) && !deAparelho(c)).length,
      destino: this.fonte.destino,
    });
  }

  @Post('rede-cpf/bloquear')
  @HttpCode(200)
  @Permissao(C.usuarioBloquear)
  @AuditadoNoHandler(
    'executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na transação de cada acesso.bloquearUsuario, no banco de cada estabelecimento',
  )
  async bloquear(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBloqueioRedeCpf> {
    const p = analisar(esquemaBloquearRedeCpf, corpo);
    const s = sessaoDe(req);
    const auditor = conferirGestao({ login: s.login, perfis: s.perfis }, 'bloquear-usuario', null);
    if (auditor)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        mensagemRecusaGestao(auditor, 'bloquear-usuario'),
        {
          codigo: auditor,
        },
      );
    const chave = idempotencia(req);
    const cpf = await this.cpfDoAlvo(req, { cpf: p.cpf || undefined, login: p.login || undefined });
    const lidos = await this.lerRede(req, cpf);
    // Regra 7: ninguém bloqueia a si mesmo, nem por outro login da mesma pessoa.
    const daSessao = lidos.find((l) => l.codigo === s.hospital)?.contas ?? [];
    if (daSessao.some((c) => c.login === s.login))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        mensagemRecusaGestao('a-si-mesmo', 'bloquear-usuario'),
        { codigo: 'a-si-mesmo' },
      );
    const reaut = await reautenticado(this.servico, this.resolvedor, req, p.senha);
    const resultados: ResultadoBloqueioRedeCpf['resultados'] = [];
    for (const l of lidos) {
      if (!l.contas) {
        resultados.push({
          estabelecimento: l.codigo,
          login: null,
          resultado: 'indisponivel',
          detalhe: 'O banco do estabelecimento não respondeu: repita o bloqueio depois.',
        });
        continue;
      }
      for (const c of l.contas) {
        const item = (
          resultado: ResultadoBloqueioRedeCpf['resultados'][number]['resultado'],
          detalhe: string | null = null,
        ) => resultados.push({ estabelecimento: l.codigo, login: c.login, resultado, detalhe });
        if (c.bloqueado) {
          item('ja-bloqueado');
          continue;
        }
        if (!c.ativo) {
          item('inativo');
          continue;
        }
        if (deAparelho(c)) {
          item('recusado', 'Conta de aparelho: bloqueie pela ficha, depois da troca do aparelho.');
          continue;
        }
        const seg = conferirGestao({ login: s.login, perfis: s.perfis }, 'bloquear-usuario', c.login);
        if (seg) {
          item('recusado', mensagemRecusaGestao(seg, 'bloquear-usuario'));
          continue;
        }
        try {
          await exigirGestorRestante(this.gestores, s.rede, l.codigo, { tipo: 'bloquear', login: c.login });
          await this.fonte.executar(
            'acesso.bloquearUsuario',
            { login: c.login },
            {
              ...contextoOperacao(req, ORIGEM, reaut, chaveDoItem(chave, l.codigo, c.login)),
              hospital: l.codigo,
            },
          );
          await this.servico?.revogarSessoesDoUsuario(s.rede, l.codigo, c.login).catch(() => undefined);
          item('bloqueado');
        } catch (bruto) {
          let e: unknown = bruto;
          try {
            problema(bruto);
          } catch (convertido) {
            e = convertido;
          }
          const detalhe =
            e instanceof ErroProblema ? (e.detalhe ?? e.titulo) : 'A gravação falhou neste estabelecimento.';
          item(e instanceof ErroProblema && e.getStatus() === 409 ? 'recusado' : 'falhou', detalhe);
        }
      }
    }
    return semSegredos({
      resultados,
      bloqueados: resultados.filter((r) => r.resultado === 'bloqueado').length,
      destino: this.fonte.destino,
    });
  }
}
