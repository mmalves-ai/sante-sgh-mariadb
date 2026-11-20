// Respostas de erro em Problem Details (RFC 9457), em português claro, com identificador de correlação.
// Nenhum detalhe técnico (pilha, SQL, nome de tabela) vai ao cliente.
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { type CampoAlterado, type Problema, type TipoProblema, urnProblema } from '@sgh/contratos';
import { problemaDoLegado } from '@sgh/legado';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/** O mínimo da requisição e da resposta do Fastify usado aqui (sem depender dos tipos do Fastify). */
interface Requisicao {
  readonly headers: Record<string, string | string[] | undefined>;
}
interface Resposta {
  status(codigo: number): Resposta;
  header(nome: string, valor: string): Resposta;
  send(corpo: unknown): unknown;
}

/** Extras do Problem Details: no conflito de versão (M08), o que mudou e em que sistema. */
export interface ExtrasProblema {
  readonly alteracoes?: readonly CampoAlterado[];
  readonly alteradoPor?: 'legado' | 'novo' | 'desconhecido';
  /** M06: sem vínculo, a quebra de vidro está disponível para esta pessoa. */
  readonly quebraDeVidro?: boolean;
  /** M08: código da recusa e campos envolvidos (sem valores). */
  readonly codigo?: string;
  readonly campos?: readonly string[];
  /** M25: o conflito de sincronização aberto e os bloqueios e avisos dos nove certos (sem dado clínico). */
  readonly conflito?: number;
  readonly bloqueios?: readonly string[];
  readonly avisos?: readonly string[];
  /** M53.4: na programação de férias recusada, os códigos de todas as regras que ela não cumpre. */
  readonly recusas?: readonly string[];
  /** W1-01: na troca de senha recusada, as regras da política que a senha nova não cumpre (códigos). */
  readonly falhas?: readonly string[];
  /** M56.3: na baixa recusada por valor divergente, o devido calculado na data (o valor, a multa e os juros). */
  readonly devido?: Readonly<NonNullable<Problema['devido']>>;
  /** W0-02: na exclusão recusada, os dependentes (sem nome de tabela), o total e a oferta de inativar. */
  readonly dependentes?: Readonly<NonNullable<Problema['dependentes']>>;
  readonly total?: number;
  readonly podeInativar?: boolean;
}

export class ErroProblema extends HttpException {
  constructor(
    readonly tipo: TipoProblema,
    status: number,
    readonly titulo: string,
    readonly detalhe?: string,
    readonly extras: ExtrasProblema = {},
  ) {
    super(titulo, status);
  }
}

const TIPO_POR_STATUS: Partial<Record<number, TipoProblema>> = {
  400: 'entrada-invalida',
  401: 'nao-autenticado',
  403: 'sem-permissao',
  404: 'nao-encontrado',
  409: 'conflito-de-versao',
  423: 'registro-em-edicao',
  503: 'indisponivel',
};

/** Status HTTP → tipo: os mapeados acima; qualquer outro 4xx (405, 413, 415…) é entrada inválida. */
export function tipoPorStatus(status: number): TipoProblema {
  return TIPO_POR_STATUS[status] ?? (status >= 400 && status < 500 ? 'entrada-invalida' : 'erro-interno');
}

/** Erros do próprio Fastify (JSON malformado, corpo grande demais, tipo de conteúdo) trazem statusCode 4xx. */
function statusDoFastify(erro: unknown): number | null {
  const s = (erro as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' && Number.isInteger(s) && s >= 400 && s < 500 ? s : null;
}

export function correlacaoDe(req: Requisicao): string {
  const h = req.headers['x-correlacao'];
  return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
}

@Catch()
export class ProblemaFilter implements ExceptionFilter {
  catch(erro: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Requisicao>();
    const res = ctx.getResponse<Resposta>();
    const correlacao = correlacaoDe(req);
    let corpo: Problema;
    if (erro instanceof ErroProblema) {
      corpo = {
        type: urnProblema(erro.tipo),
        title: erro.titulo,
        status: erro.getStatus(),
        ...(erro.detalhe ? { detail: erro.detalhe } : {}),
        ...(erro.extras.alteracoes ? { alteracoes: [...erro.extras.alteracoes] } : {}),
        ...(erro.extras.alteradoPor ? { alteradoPor: erro.extras.alteradoPor } : {}),
        ...(erro.extras.quebraDeVidro !== undefined ? { quebraDeVidro: erro.extras.quebraDeVidro } : {}),
        ...(erro.extras.codigo ? { codigo: erro.extras.codigo } : {}),
        ...(erro.extras.campos ? { campos: [...erro.extras.campos] } : {}),
        ...(erro.extras.conflito !== undefined ? { conflito: erro.extras.conflito } : {}),
        ...(erro.extras.bloqueios ? { bloqueios: [...erro.extras.bloqueios] } : {}),
        ...(erro.extras.avisos ? { avisos: [...erro.extras.avisos] } : {}),
        ...(erro.extras.recusas ? { recusas: [...erro.extras.recusas] } : {}),
        ...(erro.extras.falhas ? { falhas: [...erro.extras.falhas] } : {}),
        ...(erro.extras.devido ? { devido: { ...erro.extras.devido } } : {}),
        ...(erro.extras.dependentes
          ? { dependentes: erro.extras.dependentes.map((x) => ({ ...x, amostra: [...x.amostra] })) }
          : {}),
        ...(erro.extras.total !== undefined ? { total: erro.extras.total } : {}),
        ...(erro.extras.podeInativar !== undefined ? { podeInativar: erro.extras.podeInativar } : {}),
        correlacao,
      };
    } else if (erro instanceof HttpException || statusDoFastify(erro) !== null) {
      const status = erro instanceof HttpException ? erro.getStatus() : statusDoFastify(erro)!;
      const tipo = tipoPorStatus(status);
      corpo = { type: urnProblema(tipo), title: tituloPadrao(tipo), status, correlacao };
    } else {
      // Erro do legado (M02): validação, CHECK e exceção de trigger viram 409 em português; o resto, 500
      // genérico. O log leva só o gdscode e a mensagem sanitizada (sem valor de coluna, sem literal).
      const { problema, log } = problemaDoLegado(erro);
      logger.error(
        {
          correlacao,
          erro: erro instanceof Error ? erro.name : typeof erro,
          gdscode: log.gdscode,
          mensagem: log.mensagem,
        },
        'erro não tratado',
      );
      corpo =
        problema.status === HttpStatus.CONFLICT
          ? { ...problema, correlacao }
          : {
              type: urnProblema('erro-interno'),
              title: tituloPadrao('erro-interno'),
              status: HttpStatus.INTERNAL_SERVER_ERROR,
              codigo: 'erro-interno',
              correlacao,
            };
    }
    void res
      .status(corpo.status ?? 500)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .header('x-correlacao', correlacao)
      .send(corpo);
  }
}

// Record exaustivo: um tipo novo em TIPOS_PROBLEMA sem título não compila.
const TITULOS: Record<TipoProblema, string> = {
  'conflito-de-versao': 'O registro foi alterado em outro lugar',
  'nao-autenticado': 'Sessão necessária',
  'sem-permissao': 'Sem permissão',
  'nao-encontrado': 'Não encontrado',
  'entrada-invalida': 'Dados inválidos',
  'registro-em-edicao': 'Registro em edição por outra pessoa',
  indisponivel: 'Serviço indisponível',
  'erro-interno': 'Erro inesperado',
  // M05
  'reautenticacao-necessaria': 'Confirme a senha para continuar',
  'muitas-tentativas': 'Muitas tentativas de entrada',
  'sessao-bloqueada': 'Sessão bloqueada',
  'operacao-bloqueada': 'Operação indisponível por ora',
  'outro-estabelecimento': 'Entre de novo no outro estabelecimento',
  'primeiro-acesso': 'Senha ainda não definida',
  'rede-desconhecida': 'Endereço sem rede configurada',
  // M06
  'trilha-indisponivel': 'Trilha de auditoria indisponível',
  'sem-vinculo': 'Sem vínculo assistencial com o paciente',
  // M08
  'recusa-de-negocio': 'Operação recusada',
  'prerequisito-pendente': 'Pré-requisito pendente',
  // M15
  'motivo-necessario': 'Informe o motivo do acesso ao prontuário',
  'recurso-desligado': 'Funcionalidade desligada neste estabelecimento',
};

export function tituloPadrao(tipo: TipoProblema): string {
  return TITULOS[tipo];
}
