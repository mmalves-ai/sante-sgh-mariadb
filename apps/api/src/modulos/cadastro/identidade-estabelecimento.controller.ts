// Identidade do estabelecimento (F3.1, 02-CAD linha 26): logotipos e mantenedora.
//   GET  /api/cadastros/estrutura-gestao/identidade                      logotipos, mantenedora ligada, mantenedoras, opções
//   GET  /api/cadastros/estrutura-gestao/identidade/pessoa?cpf=          a pessoa pelo CPF inteiro (responsável, contador)
//   GET  /api/cadastros/estrutura-gestao/logotipos/:id/imagem            a imagem (base64)
//   POST /api/cadastros/estrutura-gestao/logotipos                       envia a imagem (base64) para uma ou mais finalidades
//   PUT  /api/cadastros/estrutura-gestao/logotipos/:id                   altera finalidade, cabeçalho, rodapé e situação (versão)
//   POST /api/cadastros/estrutura-gestao/logotipos/:id/excluir           exclusão lógica, com motivo
//   POST /api/cadastros/estrutura-gestao/mantenedoras                    inclui a mantenedora (e liga o estabelecimento sem mantenedora)
//   PUT  /api/cadastros/estrutura-gestao/mantenedoras/:id                altera (versão)
//   POST /api/cadastros/estrutura-gestao/mantenedoras/:id/situacao       inativa ou reativa, com motivo (nunca apaga)
//   POST /api/cadastros/estrutura-gestao/mantenedora-ligada              liga o estabelecimento a outra, ou desliga, com motivo
// Acesso pelo nível cadastro.estrutura.editar. Gravações pelo executor, com a trilha na mesma transação.
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
import { ErroOperacao } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  type EntradaMantenedora,
  IDENTIDADE_ESTABELECIMENTO,
  type IdentidadeEstabelecimentoPropria,
} from './identidade-estabelecimento-propria.js';

const PERMISSAO = 'cadastro.estrutura.editar';
/** Teto do corpo em base64 para a imagem de até 512 KB. */
const BASE64_MAXIMO = 800_000;

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
const sim = (v: unknown): boolean => v === true;
const motivo = (b: Corpo): string => (typeof b['motivo'] === 'string' ? b['motivo'].trim() : '');

@Controller('cadastros/estrutura-gestao')
export class IdentidadeEstabelecimentoController {
  constructor(
    @Optional()
    @Inject(IDENTIDADE_ESTABELECIMENTO)
    private readonly identidade: IdentidadeEstabelecimentoPropria | null = null,
  ) {}

  private porta(): IdentidadeEstabelecimentoPropria {
    if (!this.identidade)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Esta gravação precisa do banco do cliente.',
      );
    return this.identidade;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // O logotipo ou a mantenedora que não existe (ou já excluído) é 404, com o código da porta.
      if (e instanceof ErroOperacao && e.problema.status === 404)
        throw new ErroProblema('nao-encontrado', 404, e.problema.title, e.problema.detail, {
          codigo: e.problema.codigo ?? 'registro-inexistente',
        });
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, evento: string, op: string, tabela: string, dono: number | string) {
    return linhaTrilha(s, evento, 'cadastro.estrutura', op, { tabela, id: String(dono) });
  }

  @Get('identidade')
  @Permissao(PERMISSAO)
  ler(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.porta().lerTudo(s.porta));
  }

  @Get('identidade/pessoa')
  @Permissao(PERMISSAO)
  async pessoa(@Query('cpf') cpf: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const d = digitos(cpf) ?? '';
    if (d.length !== 11)
      throw new ErroProblema('entrada-invalida', 422, 'CPF inválido', 'Informe o CPF inteiro (11 dígitos).', {
        codigo: 'cpf-invalido',
        campos: ['cpf'],
      });
    return { pessoa: await this.rodar(() => this.porta().pessoaPorCpf(s.porta, d)) };
  }

  @Get('logotipos/:id/imagem')
  @Permissao(PERMISSAO)
  async imagem(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = await this.rodar(() => this.porta().imagemLogotipo(s.porta, idDaRota(p)));
    return { tipo: f.tipo, conteudo: f.conteudo.toString('base64') };
  }

  @Post('logotipos')
  @HttpCode(201)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async enviarLogotipo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const base64 = typeof b['conteudo'] === 'string' ? b['conteudo'].replace(/^data:[^,]*,/, '') : '';
    if (!base64 || base64.length > BASE64_MAXIMO || !/^[A-Za-z0-9+/=\s]+$/.test(base64))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Imagem inválida',
        'Envie a imagem PNG ou JPEG, com até 512 KB.',
        { codigo: 'arquivo-nao-imagem', campos: ['conteudo'] },
      );
    const p = this.porta();
    const est = await this.rodar(() => p.estabelecimento(s.porta));
    const e = {
      conteudo: new Uint8Array(Buffer.from(base64, 'base64')),
      nomeOriginal: txt(b['nomeOriginal']) ?? 'logotipo',
      finalidades: Array.isArray(b['finalidades'])
        ? (b['finalidades'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20)
        : [],
      cabecalhoRelatorio: txt(b['cabecalhoRelatorio']),
      rodapeRelatorio: txt(b['rodapeRelatorio']),
      imprimeEmRelatorio: b['imprimeEmRelatorio'] !== false,
    };
    const t = this.trilha(s, 'cadastro.logotipo.enviado', 'enviarLogotipo', 'logotipo_estabelecimento', est);
    return { ids: await this.rodar(() => p.enviarLogotipo(s.porta, e, t)) };
  }

  @Put('logotipos/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarLogotipo(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const n = idDaRota(p);
    const e = {
      id: n,
      versao: id(b['versao']) ?? 0,
      finalidade: typeof b['finalidade'] === 'string' ? b['finalidade'] : '',
      cabecalhoRelatorio: txt(b['cabecalhoRelatorio']),
      rodapeRelatorio: txt(b['rodapeRelatorio']),
      imprimeEmRelatorio: sim(b['imprimeEmRelatorio']),
      ativo: sim(b['ativo']),
    };
    const t = this.trilha(s, 'cadastro.logotipo.gravado', 'alterarLogotipo', 'logotipo_estabelecimento', n);
    return { id: await this.rodar(() => this.porta().alterarLogotipo(s.porta, e, t)) };
  }

  @Post('logotipos/:id/excluir')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async excluirLogotipo(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const n = idDaRota(p);
    const e = { id: n, versao: id(b['versao']) ?? 0, motivo: motivo(b) };
    const t = this.trilha(s, 'cadastro.logotipo.excluido', 'excluirLogotipo', 'logotipo_estabelecimento', n);
    return { id: await this.rodar(() => this.porta().excluirLogotipo(s.porta, e, t)) };
  }

  private mantenedora(corpo: unknown, rid: number | null): EntradaMantenedora {
    const b = corpoDe(corpo);
    const fixo = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    return {
      id: rid,
      versao: rid ? (id(b['versao']) ?? 0) : null,
      codigo: fixo('codigo'),
      razaoSocial: fixo('razaoSocial'),
      nomeFantasia: txt(b['nomeFantasia']),
      cnpj: digitos(b['cnpj']) ?? '',
      naturezaJuridica: id(b['naturezaJuridica']),
      inscricaoEstadual: txt(b['inscricaoEstadual']),
      inscricaoMunicipal: txt(b['inscricaoMunicipal']),
      nire: digitos(b['nire']),
      dataRegistroNire: txt(b['dataRegistroNire']),
      registroCivil: txt(b['registroCivil']),
      dataRegistroCivil: txt(b['dataRegistroCivil']),
      cnaePrincipal: digitos(b['cnaePrincipal']),
      registroAns: digitos(b['registroAns']),
      optanteSimples: sim(b['optanteSimples']),
      filantropica: sim(b['filantropica']),
      incentivoCultural: sim(b['incentivoCultural']),
      tipoDeclarante: txt(b['tipoDeclarante']),
      responsavel: id(b['responsavel']),
      contador: id(b['contador']),
      contadorCrc: txt(b['contadorCrc']),
      site: txt(b['site']),
      // Incluir liga o estabelecimento, salvo pedido em contrário; alterar só liga quando pedido.
      ligar: rid ? b['ligar'] === true : b['ligar'] !== false,
    };
  }

  @Post('mantenedoras')
  @HttpCode(201)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async incluirMantenedora(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const t = this.trilha(s, 'cadastro.mantenedora.gravada', 'incluirMantenedora', 'mantenedora', 0);
    return {
      id: await this.rodar(() => this.porta().gravarMantenedora(s.porta, this.mantenedora(corpo, null), t)),
    };
  }

  @Put('mantenedoras/:id')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async alterarMantenedora(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const t = this.trilha(s, 'cadastro.mantenedora.gravada', 'alterarMantenedora', 'mantenedora', n);
    return {
      id: await this.rodar(() => this.porta().gravarMantenedora(s.porta, this.mantenedora(corpo, n), t)),
    };
  }

  @Post('mantenedoras/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async situacaoMantenedora(
    @Param('id') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const n = idDaRota(p);
    const e = { id: n, versao: id(b['versao']) ?? 0, ativo: sim(b['ativo']), motivo: motivo(b) };
    const t = this.trilha(s, 'cadastro.mantenedora.situacao', 'situacaoMantenedora', 'mantenedora', n);
    return { id: await this.rodar(() => this.porta().situacaoMantenedora(s.porta, e, t)) };
  }

  @Post('mantenedora-ligada')
  @HttpCode(200)
  @Permissao(PERMISSAO)
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async ligarMantenedora(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = corpoDe(corpo);
    const p = this.porta();
    const est = await this.rodar(() => p.estabelecimento(s.porta));
    const e = { mantenedora: id(b['mantenedora']), motivo: motivo(b) };
    const t = this.trilha(s, 'cadastro.mantenedora.ligada', 'ligarMantenedora', 'estabelecimento', est);
    return { id: await this.rodar(() => p.ligarMantenedora(s.porta, e, t)) };
  }
}
