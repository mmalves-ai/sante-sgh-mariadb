// Ficha complementar do paciente (F3.1, 02-CAD linhas 2, 3 e 4), sobre FichaComplementarPropria:
//   GET  /api/cadastros/pacientes/:id/contatos                         endereços, telefones e e-mails da pessoa
//   POST /api/cadastros/pacientes/:id/enderecos|telefones|emails       inclui (um principal por espécie)
//   POST /api/cadastros/pacientes/:id/contatos/:especie/:cid/principal torna principal
//   POST /api/cadastros/pacientes/:id/contatos/:especie/:cid/encerrar  tira de uso (nada se apaga)
//   GET  /api/cadastros/pacientes/:id/responsaveis                     responsáveis, familiares e pendências
//   POST /api/cadastros/pacientes/:id/responsaveis                     inclui (pessoa única pelo CPF)
//   POST /api/cadastros/pacientes/:id/responsaveis/:rid/encerrar       encerra a vigência, com motivo
//   GET  /api/cadastros/pacientes/:id/campos-pendentes                 o que falta para abrir o atendimento no escopo
//   GET  /api/cadastros/ficha-complementar/tipos                       tipos de endereço, telefone e parentesco
//   GET|POST /api/cadastros/regras-campo, POST .../:rid/inativar       regras de campo do cadastro
// Acesso só pelos níveis de cada cargo: leitura da ficha (cadastro.paciente.ler), edição (cadastro.paciente.editar),
// parâmetros (config.parametro.ler/editar). Gravações pelo executor, com a trilha na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { TIPOS_ATENDIMENTO_REGRA, type TipoAtendimentoRegra } from '@sgh/dominio-cadastro';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  type ContatosPessoa,
  type EspecieContato,
  FICHA_COMPLEMENTAR,
  type FichaComplementarPropria,
  type RegraCampoLida,
  type ResponsaveisPaciente,
} from './ficha-complementar-proprio.js';

const EVENTO = 'cadastro.paciente.gravado';
const ESPECIES: readonly EspecieContato[] = ['endereco', 'telefone', 'email'];

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;
const digitos = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D+/g, '') : '';
const id = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const sim = (v: unknown): boolean => v === true;

@Controller('cadastros')
export class FichaComplementarController {
  constructor(
    @Optional() @Inject(FICHA_COMPLEMENTAR) private readonly ficha: FichaComplementarPropria | null = null,
  ) {}

  private servico(): FichaComplementarPropria {
    if (!this.ficha)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A ficha complementar precisa do banco do cliente (não há porta em memória).',
      );
    return this.ficha;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, paciente: number | null) {
    return linhaTrilha(s, EVENTO, 'cadastro.ficha-complementar', op, { tabela, paciente });
  }

  // ── Contatos ──

  @Get('pacientes/:id/contatos')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async contatos(@Param('id') p: string, @Req() req: RequisicaoAutorizada): Promise<ContatosPessoa> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    req.sghAlvo = { paciente: n, tabelaAlvo: 'paciente', idAlvo: String(n) };
    return this.rodar(() => this.servico().contatos(s.porta, n));
  }

  @Get('ficha-complementar/tipos')
  @Permissao('cadastro.paciente.ler')
  async tipos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().tipos(s.porta));
  }

  @Post('pacientes/:id/enderecos')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirEndereco(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const numero = txt(b['numero']);
    const e = {
      paciente: n,
      tipo: id(b['tipo']) ?? 0,
      cep: digitos(b['cep']),
      logradouro: txt(b['logradouro']),
      numero: sim(b['semNumero']) ? null : numero,
      semNumero: sim(b['semNumero']),
      complemento: txt(b['complemento']),
      bairro: txt(b['bairro']),
      pontoReferencia: txt(b['pontoReferencia']),
      principal: sim(b['principal']),
      vigenciaInicio: txt(b['vigenciaInicio']),
      vigenciaFim: txt(b['vigenciaFim']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirEndereco(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirEnderecoPessoa', 'endereco_pessoa', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/telefones')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirTelefone(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      paciente: n,
      tipo: id(b['tipo']) ?? 0,
      ddi: digitos(b['ddi']) || '55',
      ddd: digitos(b['ddd']) || null,
      numero: digitos(b['numero']),
      ramal: txt(b['ramal']),
      nomeContato: txt(b['nomeContato']),
      principal: sim(b['principal']),
      aceitaMensagem: sim(b['aceitaMensagem']),
      usaAplicativoMensagem: sim(b['usaAplicativoMensagem']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirTelefone(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirTelefonePessoa', 'telefone_pessoa', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/emails')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirEmail(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const e = {
      paciente: n,
      email: txt(b['email']) ?? '',
      finalidade: txt(b['finalidade']) ?? 'pessoal',
      principal: sim(b['principal']),
      aceitaComunicacao: sim(b['aceitaComunicacao']),
      aceiteDeclarado: sim(b['aceiteDeclarado']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirEmail(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirEmailPessoa', 'email_pessoa', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/contatos/:especie/:cid/:acao')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async ajustarContato(
    @Param('id') p: string,
    @Param('especie') especie: string,
    @Param('cid') cid: string,
    @Param('acao') acao: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    if (!ESPECIES.includes(especie as EspecieContato) || (acao !== 'principal' && acao !== 'encerrar'))
      throw new ErroProblema('nao-encontrado', 404, 'Rota inexistente');
    const r = await this.rodar(() =>
      this.servico().ajustarContato(
        s.porta,
        { paciente: n, especie: especie as EspecieContato, id: idDaRota(cid), acao },
        this.trilha(s, 'cadastro.ajustarContatoPessoa', `${especie}_pessoa`, n),
      ),
    );
    return { id: r };
  }

  // ── Responsáveis ──

  @Get('pacientes/:id/responsaveis')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async responsaveis(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResponsaveisPaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    req.sghAlvo = { paciente: n, tabelaAlvo: 'responsavel_paciente', idAlvo: String(n) };
    return this.rodar(() => this.servico().responsaveis(s.porta, n));
  }

  @Post('pacientes/:id/responsaveis')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirResponsavel(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const prioridade = typeof b['prioridadeContato'] === 'number' ? b['prioridadeContato'] : null;
    const e = {
      paciente: n,
      cpf: digitos(b['cpf']),
      nome: txt(b['nome'])?.toUpperCase() ?? null,
      nascimento: txt(b['nascimento']),
      papel: (txt(b['papel']) ?? '') as never,
      parentesco: id(b['parentesco']),
      autorizarProcedimento: sim(b['autorizarProcedimento']),
      receberInformacao: sim(b['receberInformacao']),
      retirarDocumento: sim(b['retirarDocumento']),
      contatoPrincipal: sim(b['contatoPrincipal']),
      prioridadeContato: prioridade,
      vigenciaInicio: txt(b['vigenciaInicio']),
      vigenciaFim: txt(b['vigenciaFim']),
      comprovante: id(b['comprovante']),
      observacao: txt(b['observacao']),
    };
    const r = await this.rodar(() =>
      this.servico().incluirResponsavel(
        s.porta,
        e,
        this.trilha(s, 'cadastro.incluirResponsavelPaciente', 'responsavel_paciente', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/responsaveis/:rid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarResponsavel(
    @Param('id') p: string,
    @Param('rid') rid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().encerrarResponsavel(
        s.porta,
        {
          paciente: n,
          id: idDaRota(rid),
          levantamentoCuratela: sim(b['levantamentoCuratela']),
          motivo: txt(b['motivo']) ?? '',
        },
        this.trilha(s, 'cadastro.encerrarResponsavelPaciente', 'responsavel_paciente', n),
      ),
    );
    return { id: r };
  }

  // ── Regras de campo ──

  @Get('pacientes/:id/campos-pendentes')
  @Permissao('cadastro.paciente.ler')
  async camposPendentes(
    @Param('id') p: string,
    @Query('modulo') modulo: string | undefined,
    @Query('tipoAtendimento') tipo: string | undefined,
    @Query('fontePagadora') fonte: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ pendentes: { campo: string; rotulo: string }[] }> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const tipoAtendimento = TIPOS_ATENDIMENTO_REGRA.includes(tipo as TipoAtendimentoRegra)
      ? (tipo as TipoAtendimentoRegra)
      : null;
    const pendentes = await this.rodar(() =>
      this.servico().camposPendentes(s.porta, n, {
        modulo: id(modulo),
        tipoAtendimento,
        fontePagadora: id(fonte),
      }),
    );
    return { pendentes };
  }

  @Get('regras-campo')
  @Permissao('config.parametro.ler')
  async regras(
    @Query('inativas') inativas: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: RegraCampoLida[] }> {
    const s = sessaoDe(req);
    return { itens: await this.rodar(() => this.servico().regrasCampo(s.porta, inativas === '1')) };
  }

  @Post('regras-campo')
  @HttpCode(201)
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async gravarRegra(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const e = {
      estabelecimento: sim(b['todaRede']) ? null : s.porta.estabelecimento,
      campo: txt(b['campo']) ?? '',
      modulo: id(b['modulo']),
      tipoAtendimento: (txt(b['tipoAtendimento']) ?? 'todos') as TipoAtendimentoRegra,
      fontePagadora: id(b['fontePagadora']),
      exigencia: (txt(b['exigencia']) ?? '') as never,
      rotulo: txt(b['rotulo']),
    };
    const r = await this.rodar(() =>
      this.servico().gravarRegraCampo(
        s.porta,
        e,
        this.trilha(s, 'cadastro.gravarRegraCampo', 'regra_campo_cadastro', null),
      ),
    );
    return { id: r };
  }

  @Post('regras-campo/:rid/inativar')
  @HttpCode(200)
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async inativarRegra(@Param('rid') rid: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const versao = id(corpoDe(corpo)['versao']) ?? 0;
    const r = await this.rodar(() =>
      this.servico().inativarRegraCampo(
        s.porta,
        idDaRota(rid),
        versao,
        this.trilha(s, 'cadastro.inativarRegraCampo', 'regra_campo_cadastro', null),
      ),
    );
    return { id: r };
  }
}
