// Representação do paciente (F3.1, 02-CAD linha 4): condição de incapacidade e comprovante enviado pela tela.
//   GET  /api/cadastros/pacientes/:id/incapacidades                    condição vigente, histórico e o aviso da abertura
//   POST /api/cadastros/pacientes/:id/incapacidades                    registra (data de início e documento)
//   POST /api/cadastros/pacientes/:id/incapacidades/:iid/encerrar      levantamento, com data e motivo (nada apagado)
//   POST /api/cadastros/pacientes/:id/comprovantes-representacao       envia o documento (base64) e liga ao vínculo
//                                                                      do responsável ou à incapacidade
// Toda gravação passa pelo executor (trilha na mesma transação). Só no banco do cliente (sem ele, 503).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  ALVOS_COMPROVANTE,
  type AlvoComprovante,
  type IncapacidadesPaciente,
  REPRESENTACAO_PACIENTE,
  type RepresentacaoPacientePropria,
} from './representacao-paciente-propria.js';

const EVENTO = 'cadastro.paciente.gravado';
/** Base64 de até 640 KB (o corpo JSON da rota cabe no limite de 1 MB do servidor). */
const BASE64_MAXIMO = 900_000;

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

@Controller('cadastros')
export class RepresentacaoPacienteController {
  constructor(
    @Optional()
    @Inject(REPRESENTACAO_PACIENTE)
    private readonly representacao: RepresentacaoPacientePropria | null = null,
  ) {}

  private servico(): RepresentacaoPacientePropria {
    if (!this.representacao)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A representação do paciente precisa do banco do cliente (não há porta em memória).',
      );
    return this.representacao;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, paciente: number) {
    return linhaTrilha(s, EVENTO, 'cadastro.representacao-paciente', op, { tabela, paciente });
  }

  @Get('pacientes/:id/incapacidades')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async incapacidades(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IncapacidadesPaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    req.sghAlvo = { paciente: n, tabelaAlvo: 'incapacidade_paciente', idAlvo: String(n) };
    return this.rodar(() => this.servico().incapacidades(s.porta, n));
  }

  @Post('pacientes/:id/incapacidades')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async registrar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().registrarIncapacidade(
        s.porta,
        {
          paciente: n,
          inicio: txt(b['inicio']) ?? '',
          documentoTipo: txt(b['documentoTipo']) ?? '',
          documentoNumero: txt(b['documentoNumero']),
          documentoData: txt(b['documentoData']),
          comprovante: null,
          observacao: txt(b['observacao']),
        },
        this.trilha(s, 'cadastro.registrarIncapacidadePaciente', 'incapacidade_paciente', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/incapacidades/:iid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrar(
    @Param('id') p: string,
    @Param('iid') iid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().encerrarIncapacidade(
        s.porta,
        { paciente: n, id: idDaRota(iid), fim: txt(b['fim']) ?? '', motivo: txt(b['motivo']) ?? '' },
        this.trilha(s, 'cadastro.encerrarIncapacidadePaciente', 'incapacidade_paciente', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/comprovantes-representacao')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async enviarComprovante(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const alvo = txt(b['alvo']) as AlvoComprovante | null;
    if (!alvo || !ALVOS_COMPROVANTE.includes(alvo))
      throw new ErroProblema(
        'requisicao-invalida',
        400,
        'Requisição inválida',
        'Informe a que o comprovante se refere: o vínculo do responsável ou a incapacidade.',
        { codigo: 'alvo-invalido', campos: ['alvo'] },
      );
    const base64 = typeof b['conteudo'] === 'string' ? b['conteudo'].replace(/^data:[^,]*,/, '') : '';
    if (!base64 || base64.length > BASE64_MAXIMO || !/^[A-Za-z0-9+/=\s]+$/.test(base64))
      throw new ErroProblema(
        'requisicao-invalida',
        400,
        'Requisição inválida',
        'Envie o comprovante em PDF, PNG ou JPEG, com até 640 KB.',
        { codigo: 'arquivo-invalido', campos: ['conteudo'] },
      );
    const tabela = alvo === 'responsavel' ? 'responsavel_paciente' : 'incapacidade_paciente';
    const arquivo = await this.rodar(() =>
      this.servico().enviarComprovante(
        s.porta,
        {
          paciente: n,
          alvo,
          id: idDaRota(String(b['id'] ?? '')),
          conteudo: new Uint8Array(Buffer.from(base64, 'base64')),
          nomeOriginal: txt(b['nome']) ?? 'comprovante',
        },
        this.trilha(s, 'cadastro.anexarComprovanteRepresentacao', tabela, n),
      ),
    );
    return { arquivo };
  }
}
