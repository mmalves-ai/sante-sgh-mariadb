// Dados demográficos do paciente (F3.1, 02-CAD linha 15): nome social, identidade de gênero, raça/cor e povo indígena,
// escolaridade, ocupação, religião, nacionalidade, país de nascimento, capacidade civil e vulnerabilidades.
//   GET  /api/cadastros/pacientes/:id/demografia                         o que está gravado, os vocabulários e a lista
//   PUT  /api/cadastros/pacientes/:id/demografia                         grava o bloco inteiro (regra do domínio)
//   GET  /api/cadastros/ocupacoes-em-uso?termo=                          busca da ocupação (código ou trecho; até 20)
//   POST /api/cadastros/pacientes/:id/vulnerabilidades                   declara a condição (data e informante)
//   POST /api/cadastros/pacientes/:id/vulnerabilidades/:vid/encerrar     encerra com data (nada apagado)
//   POST /api/cadastros/pacientes/:id/condicoes-cronicas                 declara a doença crônica referida
//   POST /api/cadastros/pacientes/:id/condicoes-cronicas/:cid/encerrar   encerra com data (nada apagado)
// Atributos do cadastro nacional (09-AREA linha 73): orientação sexual, situação familiar e língua indígena no bloco.
// Toda gravação passa pelo executor (trilha na mesma transação). Só no banco do cliente (sem ele, 503).
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
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { exigir, idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  DEMOGRAFIA_PACIENTE,
  type DemografiaPaciente,
  type DemografiaPacientePropria,
} from './demografia-paciente-propria.js';

const EVENTO = 'cadastro.paciente.gravado';

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Id de opção do corpo: inteiro positivo, ou nulo quando o campo vem vazio. Outro valor recusa com o campo. */
function opcao(b: Corpo, campo: string): number | null {
  const v = b[campo];
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema('entrada-invalida', 422, 'Dados inválidos', 'A opção escolhida não é válida.', {
      codigo: 'opcao-invalida',
      campos: [campo],
    });
  return n;
}

const VER_SENSIVEL = 'cadastro.paciente.verSensivel';

@Controller('cadastros')
export class DemografiaPacienteController {
  constructor(
    @Optional()
    @Inject(DEMOGRAFIA_PACIENTE)
    private readonly demografia: DemografiaPacientePropria | null = null,
    @Optional() @Inject(REGISTRADOR_TRILHA) private readonly registro: RegistradorTrilha | null = null,
  ) {}

  /**
   * A vulnerabilidade e a doença crônica são dado sensível (LGPD art. 5º II): declarar e encerrar pedem, além da
   * edição, a permissão de ver dado sensível (quem não vê a lista não encerra nem confere a já vigente).
   */
  private async exigirSensivel(s: SessaoCadastro): Promise<void> {
    if (s.pode(VER_SENSIVEL)) return;
    if (this.registro) await exigir(s, VER_SENSIVEL, this.registro);
    throw new ErroProblema(
      'sem-permissao',
      403,
      'Acesso negado',
      'O seu perfil não vê dado sensível do paciente.',
      {
        codigo: 'sem-permissao',
      },
    );
  }

  private servico(): DemografiaPacientePropria {
    if (!this.demografia)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'Os dados demográficos do paciente precisam do banco do cliente (não há porta em memória).',
      );
    return this.demografia;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, paciente: number) {
    return linhaTrilha(s, EVENTO, 'cadastro.demografia-paciente', op, { tabela, paciente });
  }

  @Get('pacientes/:id/demografia')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async ler(@Param('id') p: string, @Req() req: RequisicaoAutorizada): Promise<DemografiaPaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    req.sghAlvo = { paciente: n, tabelaAlvo: 'paciente', idAlvo: String(n) };
    return this.rodar(() => this.servico().demografia(s.porta, n, s.pode(VER_SENSIVEL)));
  }

  @Get('ocupacoes-em-uso')
  @Permissao('cadastro.paciente.ler')
  async ocupacoes(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.rodar(() => this.servico().ocupacoes(s.porta, String(termo ?? '').slice(0, 60)));
  }

  @Put('pacientes/:id/demografia')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async gravar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().gravar(
        s.porta,
        {
          paciente: n,
          usaNomeSocial: b['usaNomeSocial'] === true,
          nomeSocial: txt(b['nomeSocial']),
          identidadeGenero: opcao(b, 'identidadeGenero'),
          racaCor: opcao(b, 'racaCor'),
          povoIndigena: opcao(b, 'povoIndigena'),
          escolaridade: opcao(b, 'escolaridade'),
          religiao: opcao(b, 'religiao'),
          nacionalidade: opcao(b, 'nacionalidade'),
          paisNascimento: opcao(b, 'paisNascimento'),
          capacidadeCivil: opcao(b, 'capacidadeCivil'),
          orientacaoSexual: opcao(b, 'orientacaoSexual'),
          situacaoFamiliar: opcao(b, 'situacaoFamiliar'),
          idiomaIndigena: opcao(b, 'idiomaIndigena'),
          ocupacao: opcao(b, 'ocupacao'),
        },
        this.trilha(s, 'cadastro.gravarDemografiaPaciente', 'paciente', n),
        s.pode(VER_SENSIVEL),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/vulnerabilidades')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async declarar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.exigirSensivel(s);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const condicao = opcao(b, 'condicao');
    if (condicao === null)
      throw new ErroProblema('entrada-invalida', 422, 'Dados inválidos', 'Escolha a condição.', {
        codigo: 'opcao-invalida',
        campos: ['condicao'],
      });
    const r = await this.rodar(() =>
      this.servico().declararVulnerabilidade(
        s.porta,
        {
          paciente: n,
          condicao,
          declaradaEm: txt(b['declaradaEm']) ?? '',
          informanteTipo: txt(b['informanteTipo']) ?? '',
          informanteNome: txt(b['informanteNome']),
          observacao: txt(b['observacao']),
        },
        this.trilha(s, 'cadastro.declararVulnerabilidadePaciente', 'paciente_vulnerabilidade', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/vulnerabilidades/:vid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrar(
    @Param('id') p: string,
    @Param('vid') vid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    await this.exigirSensivel(s);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().encerrarVulnerabilidade(
        s.porta,
        { paciente: n, id: idDaRota(vid), fim: txt(b['fim']) ?? '' },
        this.trilha(s, 'cadastro.encerrarVulnerabilidadePaciente', 'paciente_vulnerabilidade', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/condicoes-cronicas')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async declararCronica(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.exigirSensivel(s);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const condicao = opcao(b, 'condicao');
    if (condicao === null)
      throw new ErroProblema('entrada-invalida', 422, 'Dados inválidos', 'Escolha a doença crônica.', {
        codigo: 'opcao-invalida',
        campos: ['condicao'],
      });
    const r = await this.rodar(() =>
      this.servico().declararCondicaoCronica(
        s.porta,
        {
          paciente: n,
          condicao,
          declaradaEm: txt(b['declaradaEm']) ?? '',
          informanteTipo: txt(b['informanteTipo']) ?? '',
          informanteNome: txt(b['informanteNome']),
          observacao: txt(b['observacao']),
        },
        this.trilha(s, 'cadastro.declararCondicaoCronicaPaciente', 'paciente_condicao_cronica', n),
      ),
    );
    return { id: r };
  }

  @Post('pacientes/:id/condicoes-cronicas/:cid/encerrar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async encerrarCronica(
    @Param('id') p: string,
    @Param('cid') cid: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    await this.exigirSensivel(s);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const r = await this.rodar(() =>
      this.servico().encerrarCondicaoCronica(
        s.porta,
        { paciente: n, id: idDaRota(cid), fim: txt(b['fim']) ?? '' },
        this.trilha(s, 'cadastro.encerrarCondicaoCronicaPaciente', 'paciente_condicao_cronica', n),
      ),
    );
    return { id: r };
  }
}
