// Complemento do cadastro do profissional (F3.1, 02-CAD linha 16), sobre ProfissionalComplementoProprio:
//   GET  /api/cadastros/profissionais/:id/complemento                  RQE e assinaturas (corpo clínico)
//   POST /api/cadastros/profissionais/:id/rqes                         inclui RQE (exige o registro no conselho da UF)
//   POST /api/cadastros/profissionais/:id/assinaturas                  inclui imagem ou certificado (uma vigente por tipo)
//   GET  /api/cadastros/profissionais/:id/financeiro                   dados fiscais e contas (cargo do repasse)
//   POST /api/cadastros/profissionais/:id/dados-fiscais                inclui o dado fiscal (encerra o anterior aberto)
//   POST /api/cadastros/profissionais/:id/contas                       inclui conta ou chave (uma principal)
//   POST /api/cadastros/profissionais/:id/assinaturas/imagem           envia a imagem (base64) e inclui a assinatura
//   POST /api/cadastros/profissionais/:id/:tipo/:rid/encerrar          RQE e assinatura: encerra ou inativa
//   POST /api/cadastros/profissionais/:id/financeiro/:tipo/:rid/encerrar  dado fiscal e conta (cargo do repasse)
//   GET  /api/cadastros/profissionais-complemento/opcoes?empresa=      bancos, tipos de conta, especialidades, empresas
// Acesso só pelos níveis de cada cargo: RQE e assinatura com cadastro.profissional.ler/editar; o dado fiscal e o
// bancário com cadastro.profissionalFinanceiro.ler/editar (cargo do repasse). Gravações pelo executor, com a trilha.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  COMPLEMENTO_PROFISSIONAL,
  type ComplementoProfissional,
  type FinanceiroProfissional,
  type ProfissionalComplementoProprio,
} from './profissional-complemento-proprio.js';

const EVENTO = 'cadastro.profissional.gravado';
export const PERMISSAO_FINANCEIRO_LER = 'cadastro.profissionalFinanceiro.ler';
export const PERMISSAO_FINANCEIRO_EDITAR = 'cadastro.profissionalFinanceiro.editar';

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
const decimal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const sim = (v: unknown): boolean => v === true;
// Cada grupo tem a sua rota e o seu nível: RQE e assinatura com a edição do profissional; dado fiscal e conta só com o
// nível do cargo do repasse (o mesmo da inclusão).
const TIPOS_ENCERRAR_CLINICO = { rqes: 'profissional_rqe', assinaturas: 'profissional_assinatura' } as const;
const TIPOS_ENCERRAR_FINANCEIRO = {
  'dados-fiscais': 'profissional_dado_fiscal',
  contas: 'conta_bancaria_profissional',
} as const;

@Controller('cadastros')
export class ProfissionalComplementoController {
  constructor(
    @Optional()
    @Inject(COMPLEMENTO_PROFISSIONAL)
    private readonly complementoPorta: ProfissionalComplementoProprio | null = null,
  ) {}

  private servico(): ProfissionalComplementoProprio {
    if (!this.complementoPorta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O complemento do profissional precisa do banco do cliente (não há porta em memória).',
      );
    return this.complementoPorta;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, profissional: number) {
    return linhaTrilha(s, EVENTO, 'cadastro.profissional-complemento', op, {
      tabela,
      chave: `profissional:${profissional}`,
    });
  }

  private alvo(req: RequisicaoAutorizada, n: number) {
    req.sghAlvo = { tabelaAlvo: 'profissional', idAlvo: String(n) };
  }

  @Get('profissionais/:id/complemento')
  @Permissao('cadastro.profissional.ler')
  async complemento(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComplementoProfissional> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    return this.rodar(() => this.servico().complemento(s.porta, n));
  }

  @Get('profissionais/:id/financeiro')
  @Permissao(PERMISSAO_FINANCEIRO_LER)
  @Auditar('cadastro.profissional.financeiro.lido')
  async financeiro(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FinanceiroProfissional> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    this.alvo(req, n);
    return this.rodar(() => this.servico().financeiro(s.porta, n));
  }

  @Get('profissionais-complemento/opcoes')
  @Permissao('cadastro.profissional.ler')
  async opcoes(@Query('empresa') empresa: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().opcoes(s.porta, txt(empresa)));
  }

  @Post('profissionais/:id/rqes')
  @HttpCode(201)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirRqe(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      profissional: n,
      numero: digitos(b['numero']) ?? txt(b['numero']) ?? '',
      uf: (txt(b['uf']) ?? '').toUpperCase(),
      especialidade: id(b['especialidade']) ?? 0,
      dataRegistro: txt(b['dataRegistro']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirRqe(s.porta, e, this.trilha(s, 'cadastro.incluirRqe', 'profissional_rqe', n)),
    );
    return { id: r };
  }

  @Post('profissionais/:id/assinaturas')
  @HttpCode(201)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirAssinatura(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const tipo = b['tipo'] === 'imagem' ? 'imagem' : 'certificado_digital';
    const e = {
      profissional: n,
      tipo: tipo as 'imagem' | 'certificado_digital',
      arquivo: id(b['arquivo']),
      titular: txt(b['titular']),
      numeroSerie: txt(b['numeroSerie'])?.replace(/[\s:]+/g, '') ?? null,
      emissor: txt(b['emissor']),
      impressaoDigital: txt(b['impressaoDigital'])?.replace(/[\s:]+/g, '') ?? null,
      usoTiss: sim(b['usoTiss']),
      vigenciaInicio: txt(b['vigenciaInicio']) ?? '',
      vigenciaFim: txt(b['vigenciaFim']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirAssinatura(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirAssinatura', 'profissional_assinatura', n),
      ),
    );
    return { id: r };
  }

  @Post('profissionais/:id/dados-fiscais')
  @HttpCode(201)
  @Permissao(PERMISSAO_FINANCEIRO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async gravarFiscal(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      profissional: n,
      estabelecimento: id(b['estabelecimento']),
      vigenciaInicio: txt(b['vigenciaInicio']) ?? '',
      vigenciaFim: txt(b['vigenciaFim']),
      tipoRecebedor: (b['tipoRecebedor'] === 'pessoa_juridica' ? 'pessoa_juridica' : 'pessoa_fisica') as
        'pessoa_fisica' | 'pessoa_juridica',
      pessoaJuridica: id(b['pessoaJuridica']),
      regime: txt(b['regime']) as never,
      inscricaoMunicipal: txt(b['inscricaoMunicipal']),
      inscricaoInss: txt(b['inscricaoInss']),
      pisPasep: digitos(b['pisPasep']),
      categoriaSefip: id(b['categoriaSefip']),
      aliquotaIss: decimal(b['aliquotaIss']),
      percentualInss: decimal(b['percentualInss']),
      retemIss: sim(b['retemIss']),
      retemInss: sim(b['retemInss']),
      retemIrrf: sim(b['retemIrrf']),
      retemPisCofinsCsll: sim(b['retemPisCofinsCsll']),
      dependentesIrrf: typeof b['dependentesIrrf'] === 'number' ? b['dependentesIrrf'] : 0,
      incidencia: txt(b['incidencia']) as never,
    };
    const r = await this.rodar(() =>
      this.servico().gravarDadoFiscal(
        s.porta,
        e,
        this.trilha(s, 'cadastro.gravarDadoFiscal', 'profissional_dado_fiscal', n),
      ),
    );
    return { id: r };
  }

  @Post('profissionais/:id/contas')
  @HttpCode(201)
  @Permissao(PERMISSAO_FINANCEIRO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirConta(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const tipoChave = txt(b['tipoChavePix']);
    const chaveBruta = txt(b['chavePix']);
    // CPF, CNPJ e celular chegam só com os dígitos (celular com +55); e-mail e aleatória como vieram.
    const chave =
      chaveBruta === null
        ? null
        : tipoChave === 'cpf' || tipoChave === 'cnpj'
          ? chaveBruta.replace(/\D+/g, '')
          : tipoChave === 'telefone'
            ? `+${chaveBruta.replace(/\D+/g, '').replace(/^(?!55)/, '55')}`
            : chaveBruta;
    const e = {
      profissional: n,
      banco: id(b['banco']),
      tipoConta: id(b['tipoConta']),
      agencia: digitos(b['agencia']),
      agenciaDigito: txt(b['agenciaDigito']),
      numeroConta: digitos(b['numeroConta']),
      contaDigito: txt(b['contaDigito']),
      tipoChavePix: tipoChave as never,
      chavePix: chave,
      favorecidoNome: txt(b['favorecidoNome']) ?? '',
      favorecidoTipo: (b['favorecidoTipo'] === 'juridica' ? 'juridica' : 'fisica') as 'fisica' | 'juridica',
      favorecidoDocumento: digitos(b['favorecidoDocumento']) ?? '',
      principal: sim(b['principal']),
      confirmaTerceiro: sim(b['confirmaTerceiro']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirConta(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirContaProfissional', 'conta_bancaria_profissional', n),
      ),
    );
    return { id: r };
  }

  @Post('profissionais/:id/assinaturas/imagem')
  @HttpCode(201)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async enviarImagem(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const base64 = typeof b['conteudo'] === 'string' ? b['conteudo'].replace(/^data:[^,]*,/, '') : '';
    if (!base64 || base64.length > 800_000 || !/^[A-Za-z0-9+/=\s]+$/.test(base64))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Imagem inválida',
        'Envie a imagem PNG ou JPEG, com até 512 KB.',
        { codigo: 'arquivo-nao-imagem', campos: ['conteudo'] },
      );
    const e = {
      profissional: n,
      conteudo: new Uint8Array(Buffer.from(base64, 'base64')),
      nomeOriginal: txt(b['nomeOriginal']) ?? 'assinatura',
      usoTiss: sim(b['usoTiss']),
      vigenciaInicio: txt(b['vigenciaInicio']) ?? '',
      vigenciaFim: txt(b['vigenciaFim']),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.vigenciaInicio))
      throw new ErroProblema('entrada-invalida', 422, 'Vigência inválida', 'Informe o início da vigência.', {
        codigo: 'vigencia-invalida',
        campos: ['vigenciaInicio'],
      });
    const r = await this.rodar(() =>
      this.servico().enviarImagemAssinatura(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirAssinatura', 'profissional_assinatura', n),
      ),
    );
    return { id: r };
  }

  @Post('profissionais/:id/:tipo/:rid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.profissional.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrar(
    @Param('id') p: string,
    @Param('tipo') tipo: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.encerrarEm(TIPOS_ENCERRAR_CLINICO, p, tipo, rid, corpo, req);
  }

  @Post('profissionais/:id/financeiro/:tipo/:rid/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSAO_FINANCEIRO_EDITAR)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarFinanceiro(
    @Param('id') p: string,
    @Param('tipo') tipo: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.encerrarEm(TIPOS_ENCERRAR_FINANCEIRO, p, tipo, rid, corpo, req);
  }

  private async encerrarEm(
    tipos: Readonly<Record<string, Parameters<ProfissionalComplementoProprio['encerrar']>[1]>>,
    p: string,
    tipo: string,
    rid: string,
    corpo: unknown,
    req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const tabela = Object.hasOwn(tipos, tipo) ? tipos[tipo] : undefined;
    if (!tabela)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Tipo de registro desconhecido.');
    const b = corpoDe(corpo);
    const e = { profissional: n, id: idDaRota(rid), versao: id(b['versao']) ?? 0, fim: txt(b['fim']) };
    const r = await this.rodar(() =>
      this.servico().encerrar(s.porta, tabela, e, this.trilha(s, 'cadastro.encerrarComplemento', tabela, n)),
    );
    return { id: r };
  }
}
