// Manutenção da estrutura e da configuração TISS (F3.1, 02-CAD linhas 25, 26 e 27):
//   GET  /api/cadastros/estrutura-gestao                          estabelecimento, unidades, setores com ramais, opções
//   GET  /api/cadastros/estrutura-gestao/profissionais?termo=     responsável do setor (até 20 pelo nome)
//   PUT  /api/cadastros/estrutura-gestao/estabelecimento          dados do estabelecimento da sessão (versão)
//   POST /api/cadastros/estrutura-gestao/unidades                 inclui a unidade assistencial
//   PUT  /api/cadastros/estrutura-gestao/unidades/:id             altera (versão)
//   POST /api/cadastros/estrutura-gestao/unidades/:id/situacao    inativa ou reativa, com motivo (nunca apaga)
//   POST /api/cadastros/estrutura-gestao/setores                  inclui o setor com os ramais
//   PUT  /api/cadastros/estrutura-gestao/setores/:id              altera o setor e os ramais (versão)
//   POST /api/cadastros/estrutura-gestao/setores/:id/situacao     inativa com data ou reativa, com motivo
//   GET  /api/cadastros/tiss-configuracao?fonte=                  vigências e faixas da fonte pagadora, opções
//   POST /api/cadastros/tiss-configuracao                         nova vigência (encerra a aberta na véspera)
//   PUT  /api/cadastros/tiss-configuracao/:id                     altera a vigência (versão; o início não muda)
//   POST /api/cadastros/tiss-configuracao/faixas                  inclui a faixa de números de guia
//   POST /api/cadastros/tiss-configuracao/faixas/:id/encerrar     encerra a faixa, com motivo (nunca apaga)
// Acesso só pelos níveis de cada cargo (cadastro.estrutura.editar, cadastro.tiss.editar). A numeração da guia é feita
// pela emissão, na mesma transação (reservarNumeroGuia), sem rota própria.
// Gravações pelo executor, com a trilha na mesma transação.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  ESTRUTURA_GESTAO,
  type EntradaEstabelecimento,
  type EntradaSetor,
  type EntradaUnidade,
  type EstruturaGestaoPropria,
} from './estrutura-gestao-proprio.js';
import {
  type EntradaConfiguracaoTiss,
  type EntradaFaixa,
  TISS_CONFIGURACAO,
  type TissConfiguracaoPropria,
} from './tiss-configuracao-proprio.js';

export const PERMISSAO_ESTRUTURA_EDITAR = 'cadastro.estrutura.editar';
export const PERMISSAO_TISS_EDITAR = 'cadastro.tiss.editar';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;
const digitos = (v: unknown): string | null => {
  const d = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D+/g, '') : '';
  return d === '' ? null : d;
};
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};
const sim = (v: unknown): boolean => v === true;

/** Normaliza o corpo: os campos de texto vazios viram nulo, os documentos só dígitos e os sim/não booleanos. */
function normalizar(
  b: Corpo,
  campos: {
    texto?: readonly string[];
    digitos?: readonly string[];
    ids?: readonly string[];
    inteiros?: readonly string[];
    sims?: readonly string[];
    fixos?: readonly string[];
  },
): Corpo {
  const r: Corpo = {};
  for (const k of campos.texto ?? []) r[k] = txt(b[k]);
  for (const k of campos.digitos ?? []) r[k] = digitos(b[k]);
  for (const k of campos.ids ?? []) r[k] = id(b[k]);
  for (const k of campos.inteiros ?? []) r[k] = inteiro(b[k]);
  for (const k of campos.sims ?? []) r[k] = sim(b[k]);
  for (const k of campos.fixos ?? []) r[k] = typeof b[k] === 'string' ? (b[k] as string).trim() : '';
  return r;
}

const CAMPOS_ESTABELECIMENTO = {
  fixos: ['razaoSocial', 'nomeFantasia'],
  texto: [
    'inscricaoEstadual',
    'inscricaoMunicipal',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'telefone',
    'email',
    'site',
    'inicioAtividade',
    'fimAtividade',
  ],
  digitos: ['cnpj', 'cnes', 'cep'],
  ids: ['tipo', 'porte', 'esfera'],
  sims: ['hospitalDia'],
} as const;

const CAMPOS_UNIDADE = {
  fixos: ['codigo', 'nome', 'tipo'],
  texto: [
    'nomeCompleto',
    'sigla',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'telefone',
    'orientacaoAcesso',
  ],
  digitos: ['cnes', 'cnpj', 'cep'],
} as const;

const CAMPOS_SETOR = {
  fixos: ['codigo', 'nome', 'tipo'],
  texto: ['sigla', 'responsavelInicio', 'responsavelFim', 'siglaAgendamento', 'observacaoAgendamento'],
  ids: ['superior', 'unidade', 'centroCusto', 'responsavel'],
  sims: [
    'podeSolicitarExames',
    'aceitaLancamentoConta',
    'producaoFaturada',
    'exigeProfissionalAgendamento',
    'exigeRecursoAgendamento',
  ],
} as const;

const CAMPOS_CONFIGURACAO = {
  ids: ['fontePagadora', 'versaoPadrao'],
  texto: ['vigenciaFim', 'codigoPrestadorOperadora', 'razaoSocialContratado'],
  fixos: [
    'vigenciaInicio',
    'identificacaoPrestador',
    'numeracaoGuia',
    'ordenacaoGuias',
    'quebraResumoInternacao',
  ],
  digitos: ['registroAns', 'cnpjContratado'],
  inteiros: ['limiteGuiasLote', 'diasRetornoConsulta'],
  sims: [
    'agrupaProcedimentoMaiorData',
    'agrupaItensIguais',
    'separaProfissionalPorGuia',
    'omiteGuiaSemValor',
    'somenteArquivo',
    'imprimeVersoGuia',
    'exigeCidAlta',
    'informaCid',
    'exigeElegibilidade',
    'elegibilidadeEletronica',
    'autorizacaoEletronica',
    'faturamentoEletronico',
    'retornoEletronico',
    'reapresentacaoEletronica',
    'consideraPagoItemSemRetorno',
  ],
} as const;

const CAMPOS_FAIXA = {
  ids: ['fontePagadora'],
  fixos: ['tipoGuia', 'formaGeracao', 'vigenciaInicio'],
  texto: ['prefixo', 'vigenciaFim'],
  inteiros: ['tamanhoFixo', 'numeroInicial', 'numeroFinal'],
} as const;

@Controller('cadastros')
export class EstruturaGestaoController {
  constructor(
    @Optional() @Inject(ESTRUTURA_GESTAO) private readonly estrutura: EstruturaGestaoPropria | null = null,
    @Optional() @Inject(TISS_CONFIGURACAO) private readonly tiss: TissConfiguracaoPropria | null = null,
  ) {}

  private disponivel<T>(p: T | null): T {
    if (!p)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Esta gravação precisa do banco do cliente.',
      );
    return p;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, evento: string, op: string, tabela: string, dono: number | string) {
    return linhaTrilha(s, evento, 'cadastro.estrutura', op, { tabela, id: String(dono) });
  }

  private situacao(corpo: unknown, rid: string) {
    const b = corpoDe(corpo);
    return {
      id: idDaRota(rid),
      versao: id(b['versao']) ?? 0,
      ativo: sim(b['ativo']),
      data: txt(b['data']),
      motivo: typeof b['motivo'] === 'string' ? b['motivo'].trim() : '',
    };
  }

  // ── Estrutura ──

  @Get('estrutura-gestao')
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  lerEstrutura(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.disponivel(this.estrutura).lerTudo(s.porta));
  }

  @Get('estrutura-gestao/profissionais')
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  profissionais(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = (termo ?? '').trim();
    if (t.length < 3) return [];
    return this.rodar(() => this.disponivel(this.estrutura).profissionais(s.porta, t.slice(0, 60)));
  }

  @Put('estrutura-gestao/estabelecimento')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarEstabelecimento(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const p = this.disponivel(this.estrutura);
    const est = await this.rodar(() => p.estabelecimento(s.porta));
    const e = {
      estabelecimento: est,
      versao: id(b['versao']) ?? 0,
      ...normalizar(b, CAMPOS_ESTABELECIMENTO),
    } as unknown as EntradaEstabelecimento;
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'alterarEstabelecimento', 'estabelecimento', est);
    return { id: await this.rodar(() => p.alterarEstabelecimento(s.porta, e, t)) };
  }

  private unidade(corpo: unknown, rid: number | null): EntradaUnidade {
    const b = corpoDe(corpo);
    return {
      id: rid,
      versao: rid ? (id(b['versao']) ?? 0) : null,
      ...normalizar(b, CAMPOS_UNIDADE),
    } as unknown as EntradaUnidade;
  }

  @Post('estrutura-gestao/unidades')
  @HttpCode(201)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirUnidade(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'incluirUnidade', 'unidade_assistencial', 'nova');
    return {
      id: await this.rodar(() =>
        this.disponivel(this.estrutura).gravarUnidade(s.porta, this.unidade(corpo, null), t),
      ),
    };
  }

  @Put('estrutura-gestao/unidades/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarUnidade(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'alterarUnidade', 'unidade_assistencial', n);
    return {
      id: await this.rodar(() =>
        this.disponivel(this.estrutura).gravarUnidade(s.porta, this.unidade(corpo, n), t),
      ),
    };
  }

  @Post('estrutura-gestao/unidades/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async situacaoUnidade(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = this.situacao(corpo, p);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'situacaoUnidade', 'unidade_assistencial', e.id);
    return { id: await this.rodar(() => this.disponivel(this.estrutura).situacaoUnidade(s.porta, e, t)) };
  }

  private setor(corpo: unknown, rid: number | null): EntradaSetor {
    const b = corpoDe(corpo);
    const ramais = Array.isArray(b['ramais']) ? (b['ramais'] as unknown[]) : [];
    return {
      id: rid,
      versao: rid ? (id(b['versao']) ?? 0) : null,
      ...normalizar(b, CAMPOS_SETOR),
      ramais: ramais.map((x) => {
        const r = corpoDe(x);
        return {
          id: id(r['id']),
          ramal: digitos(r['ramal']) ?? '',
          contato: txt(r['contato']),
          principal: sim(r['principal']),
          responsavel: sim(r['responsavel']),
          telefoneExterno: digitos(r['telefoneExterno']),
          observacao: txt(r['observacao']),
        };
      }),
    } as unknown as EntradaSetor;
  }

  @Post('estrutura-gestao/setores')
  @HttpCode(201)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirSetor(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'incluirSetor', 'setor_funcional', 'novo');
    return {
      id: await this.rodar(() =>
        this.disponivel(this.estrutura).gravarSetor(s.porta, this.setor(corpo, null), t),
      ),
    };
  }

  @Put('estrutura-gestao/setores/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarSetor(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'alterarSetor', 'setor_funcional', n);
    return {
      id: await this.rodar(() =>
        this.disponivel(this.estrutura).gravarSetor(s.porta, this.setor(corpo, n), t),
      ),
    };
  }

  @Post('estrutura-gestao/setores/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSAO_ESTRUTURA_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async situacaoSetor(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = this.situacao(corpo, p);
    const t = this.trilha(s, 'cadastro.estrutura.gravada', 'situacaoSetor', 'setor_funcional', e.id);
    return { id: await this.rodar(() => this.disponivel(this.estrutura).situacaoSetor(s.porta, e, t)) };
  }

  // ── Configuração TISS e faixas ──

  @Get('tiss-configuracao')
  @Permissao(PERMISSAO_TISS_EDITAR)
  painelTiss(@Query('fonte') fonte: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.disponivel(this.tiss).painel(s.porta, id(fonte)));
  }

  private configuracao(corpo: unknown, rid: number | null): EntradaConfiguracaoTiss {
    const b = corpoDe(corpo);
    return {
      id: rid,
      versao: rid ? (id(b['versao']) ?? 0) : null,
      ...normalizar(b, CAMPOS_CONFIGURACAO),
    } as unknown as EntradaConfiguracaoTiss;
  }

  @Post('tiss-configuracao')
  @HttpCode(201)
  @Permissao(PERMISSAO_TISS_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async novaConfiguracao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = this.configuracao(corpo, null);
    const t = this.trilha(
      s,
      'cadastro.tiss.gravada',
      'novaConfiguracao',
      'configuracao_tiss_fonte_pagadora',
      e.fontePagadora,
    );
    return { id: await this.rodar(() => this.disponivel(this.tiss).gravarConfiguracao(s.porta, e, t)) };
  }

  @Put('tiss-configuracao/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO_TISS_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarConfiguracao(
    @Param('id') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(
      s,
      'cadastro.tiss.gravada',
      'alterarConfiguracao',
      'configuracao_tiss_fonte_pagadora',
      n,
    );
    return {
      id: await this.rodar(() =>
        this.disponivel(this.tiss).gravarConfiguracao(s.porta, this.configuracao(corpo, n), t),
      ),
    };
  }

  @Post('tiss-configuracao/faixas')
  @HttpCode(201)
  @Permissao(PERMISSAO_TISS_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirFaixa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = normalizar(corpoDe(corpo), CAMPOS_FAIXA) as unknown as EntradaFaixa;
    const t = this.trilha(
      s,
      'cadastro.tiss.gravada',
      'incluirFaixa',
      'faixa_numeracao_guia',
      e.fontePagadora,
    );
    return { id: await this.rodar(() => this.disponivel(this.tiss).incluirFaixa(s.porta, e, t)) };
  }

  @Post('tiss-configuracao/faixas/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_TISS_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarFaixa(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const e = {
      id: idDaRota(p),
      versao: id(b['versao']) ?? 0,
      motivo: typeof b['motivo'] === 'string' ? b['motivo'].trim() : '',
    };
    const t = this.trilha(s, 'cadastro.tiss.gravada', 'encerrarFaixa', 'faixa_numeracao_guia', e.id);
    return { id: await this.rodar(() => this.disponivel(this.tiss).encerrarFaixa(s.porta, e, t)) };
  }
}
