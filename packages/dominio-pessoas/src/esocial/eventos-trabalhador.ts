// Eventos não periódicos do trabalhador (M53-F5; leiaute S-1.3): S-2200 admissão, S-2205 alteração cadastral, S-2206
// alteração contratual, S-2230 afastamento, S-2299 desligamento (com as verbas da rescisão calculada no M53-F4), S-2300
// e S-2399 trabalhador sem vínculo de emprego (estagiário, residente, cooperado…) e S-3000 exclusão. Os dados vêm do
// vínculo (M52: matrícula, cargo, carga, admissão e desligamento), da ficha do eSocial do vínculo (dados pessoais e
// contratuais), do salário com vigência (M53-F2), do afastamento (M53-F0) e da rescisão (M53-F4). Regras puras.
//
// D-CADINI-536 (POL-5): `cadIni` = N (o evento é do dia a dia); a carga inicial de quem já trabalhava antes do início do
// eSocial pelo Sante SGH é decisão do DP na implantação e sai com a retificação, se preciso.
// D-CATEGORIA-536 (POL-5): o tipo do vínculo sugere a categoria (CLT 101, estagiário 901, residente 902, cooperado 731);
// a ficha manda. Categoria 1xx sai pelo S-2200/S-2299; 7xx e 9xx pelo S-2300/S-2399; estatutário, PJ e terceiro não
// geram evento de trabalhador por este empregador.
import {
  type EmpregadorEsocial,
  type FichaEsocialVinculo,
  type LinhaCalculoFolha,
  MOTIVO_ESOCIAL_DA_MODALIDADE,
  type ModalidadeRescisao,
  type PendenciaEsocial,
  type TipoVinculoTrabalho,
} from '@sgh/contratos';
import {
  type ContextoEventoEsocial,
  type EmpregadorParaEvento,
  envelope,
  idEventoEsocial,
  ideEmpregador,
  ideEventoTabela,
  ideEventoTrabalhador,
  pendencia,
  raizCnpj,
  type ResultadoEventoEsocial,
} from './comum.js';
import { decimalDeCentavos, el, type NoXml, obrig, textoCampo } from './xml.js';

/** O vínculo para o evento (CPF decifrado e nome só aqui, na montagem; nunca em lista nem em log). */
export interface TrabalhadorParaEvento {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly tipo: TipoVinculoTrabalho;
  readonly cpf: string | null;
  readonly nome: string;
  readonly cargo: string | null;
  readonly funcao: string | null;
  /** Horas semanais do contrato. */
  readonly cargaSemanal: number;
  readonly admissao: string;
  readonly desligamento: string | null;
  readonly ficha: FichaEsocialVinculo | null;
  /** O salário vigente na data do evento, em centavos (null: sem vigência registrada). */
  readonly salario: number | null;
}

export interface AfastamentoParaEvento {
  readonly id: number;
  readonly motivo: number;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface RescisaoParaEvento {
  readonly id: number;
  readonly desligamento: string;
  readonly modalidade: ModalidadeRescisao;
  readonly diasIndenizados: number;
  readonly projecao: string;
  readonly linhas: readonly LinhaCalculoFolha[];
}

/** A categoria sugerida pelo tipo do vínculo (null: o tipo não gera evento de trabalhador). */
export const CATEGORIA_SUGERIDA: Readonly<Record<TipoVinculoTrabalho, string | null>> = {
  clt: '101',
  estagiario: '901',
  residente: '902',
  cooperado: '731',
  estatutario: null,
  pj: null,
  terceiro: null,
};

export const ehCategoriaEmpregado = (c: string) => /^1\d{2}$/.test(c);
export const ehCategoriaSemVinculo = (c: string) => /^[79]\d{2}$/.test(c);

/** O que o vínculo precisa ter para qualquer evento do trabalhador. */
export function pendenciasTrabalhador(t: TrabalhadorParaEvento): PendenciaEsocial[] {
  const p: PendenciaEsocial[] = [];
  if (!t.ficha) p.push(pendencia('ficha-ausente', 'O colaborador não tem a ficha do eSocial preenchida.'));
  if (!t.cpf || !/^\d{11}$/.test(t.cpf))
    p.push(pendencia('cpf-ausente', 'O CPF do colaborador não pôde ser lido.'));
  if (!textoCampo(t.nome, 70) || textoCampo(t.nome, 70)!.length < 2)
    p.push(pendencia('nome-ausente', 'O nome do colaborador está vazio.'));
  return p;
}

const sindicato = (t: TrabalhadorParaEvento, e: EmpregadorEsocial) =>
  t.ficha?.cnpjSindicato ?? e.cnpjSindicato;

function comPendencias(
  e: EmpregadorParaEvento,
  extras: readonly PendenciaEsocial[],
): { ok: false; pendencias: readonly PendenciaEsocial[] } | null {
  const p = [
    ...(e.cnpj
      ? []
      : [pendencia('empregador-sem-cnpj', 'O cadastro da empresa não tem o CNPJ de 14 posições.')]),
    ...extras,
  ];
  return p.length ? { ok: false, pendencias: p } : null;
}

function montar(
  evento: 'S-2200' | 'S-2205' | 'S-2206' | 'S-2230' | 'S-2299' | 'S-2300' | 'S-2399' | 'S-3000',
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  filhos: (cnpj: string) => readonly (NoXml | null)[],
  dataReferencia: string,
): ResultadoEventoEsocial {
  const cnpj = e.cnpj!;
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  return { ok: true, raiz: envelope(evento, ctx, filhos(cnpj), id), idEsocial: id, dataReferencia };
}

const endereco = (f: FichaEsocialVinculo): NoXml =>
  obrig('endereco', [
    obrig('brasil', [
      el('tpLograd', textoCampo(f.endereco.tipoLogradouro, 4)),
      obrig('dscLograd', textoCampo(f.endereco.logradouro, 100)),
      obrig('nrLograd', textoCampo(f.endereco.numero, 10)),
      el('complemento', textoCampo(f.endereco.complemento, 30)),
      el('bairro', textoCampo(f.endereco.bairro, 90)),
      obrig('cep', f.endereco.cep),
      obrig('codMunic', f.endereco.municipio),
      obrig('uf', f.endereco.uf),
    ]),
  ]);

/** O bloco `trabalhador` do S-2200 e do S-2300 (dados pessoais na ordem do leiaute). */
function trabalhador(t: TrabalhadorParaEvento): NoXml {
  const f = t.ficha!;
  return obrig('trabalhador', [
    obrig('cpfTrab', t.cpf),
    obrig('nmTrab', textoCampo(t.nome, 70)),
    obrig('sexo', f.sexo),
    obrig('racaCor', f.racaCor),
    el('estCiv', f.estadoCivil),
    obrig('grauInstr', f.grauInstrucao),
    el('nmSoc', textoCampo(f.nomeSocial, 70)),
    obrig('nascimento', [
      obrig('dtNascto', f.nascimento),
      obrig('paisNascto', f.paisNascimento),
      obrig('paisNac', f.paisNacionalidade),
    ]),
    endereco(f),
  ]);
}

const horasSemanais = (h: number) => (Math.round(h * 100) / 100).toFixed(2);

const localTrabGeral = (cnpj: string) => obrig('localTrabGeral', [obrig('tpInsc', 1), obrig('nrInsc', cnpj)]);
const localTrabalho = (cnpj: string) => obrig('localTrabalho', [localTrabGeral(cnpj)]);

/** `infoContrato` do S-2200 e do S-2206 (cargo, categoria, remuneração, duração, local e horário). */
function infoContrato(t: TrabalhadorParaEvento, cnpj: string): NoXml {
  const f = t.ficha!;
  return obrig('infoContrato', [
    el('nmCargo', textoCampo(t.cargo, 100)),
    el('CBOCargo', f.cboCargo),
    el('nmFuncao', textoCampo(t.funcao, 100)),
    el('CBOFuncao', t.funcao ? f.cboFuncao : null),
    obrig('codCateg', f.categoria),
    obrig('remuneracao', [obrig('vrSalFx', decimalDeCentavos(t.salario!)), obrig('undSalFixo', 5)]),
    obrig('duracao', [
      obrig('tpContr', f.tipoContrato),
      el('dtTerm', f.tipoContrato === 2 ? f.terminoContrato : null),
    ]),
    localTrabalho(cnpj),
    obrig('horContratual', [
      obrig('qtdHrsSem', horasSemanais(t.cargaSemanal)),
      obrig('tpJornada', f.tipoJornada),
      obrig('tmpParc', f.tempoParcial),
      obrig('dscJorn', textoCampo(f.descricaoJornada, 999)),
    ]),
  ]);
}

/** O que falta ao contrato do empregado (S-2200 e S-2206). */
function pendenciasContrato(t: TrabalhadorParaEvento, e: EmpregadorEsocial): PendenciaEsocial[] {
  const p = pendenciasTrabalhador(t);
  if (t.ficha && !ehCategoriaEmpregado(t.ficha.categoria))
    p.push(
      pendencia(
        'categoria-sem-vinculo',
        'A categoria do colaborador é de trabalhador sem vínculo: use o S-2300.',
      ),
    );
  if (t.ficha && !t.ficha.cboCargo)
    p.push(pendencia('cbo-ausente', 'A ficha do eSocial não tem o CBO do cargo.'));
  if (!textoCampo(t.cargo, 100)) p.push(pendencia('cargo-ausente', 'O vínculo não tem o nome do cargo.'));
  if (t.salario === null || t.salario <= 0)
    p.push(pendencia('salario-ausente', 'Não há salário vigente na data do evento.'));
  if (!sindicato(t, e))
    p.push(
      pendencia(
        'sindicato-ausente',
        'Falta o CNPJ do sindicato da categoria (na ficha ou nos parâmetros do empregador).',
      ),
    );
  return p;
}

/** S-2200: admissão do empregado (categoria 1xx). */
export function montarS2200(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const p = comPendencias(e, pendenciasContrato(t, e));
  if (p) return p;
  const f = t.ficha!;
  return montar(
    'S-2200',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      trabalhador(t),
      obrig('vinculo', [
        obrig('matricula', textoCampo(t.matricula, 30) ?? `V${t.vinculo}`),
        obrig('tpRegTrab', 1),
        obrig('tpRegPrev', 1),
        obrig('cadIni', 'N'),
        obrig('infoRegimeTrab', [
          obrig('infoCeletista', [
            obrig('dtAdm', t.admissao),
            obrig('tpAdmissao', f.tipoAdmissao),
            obrig('indAdmissao', f.indicativoAdmissao),
            obrig('tpRegJor', f.regimeJornada),
            obrig('natAtividade', f.naturezaAtividade),
            obrig('cnpjSindCategProf', sindicato(t, e)),
          ]),
        ]),
        infoContrato(t, cnpj),
      ]),
    ],
    t.admissao,
  );
}

/** A matrícula do eSocial: a do vínculo, ou "V" + ID quando o vínculo não tem matrícula. */
export const matriculaEsocial = (t: Pick<TrabalhadorParaEvento, 'matricula' | 'vinculo'>) =>
  textoCampo(t.matricula, 30) ?? `V${t.vinculo}`;

const ideVinculo = (t: TrabalhadorParaEvento) =>
  obrig('ideVinculo', [obrig('cpfTrab', t.cpf), obrig('matricula', matriculaEsocial(t))]);

/** S-2205: alteração dos dados cadastrais do trabalhador na data. */
export function montarS2205(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  data: string,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const p = comPendencias(e, pendenciasTrabalhador(t));
  if (p) return p;
  const f = t.ficha!;
  return montar(
    'S-2205',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      obrig('ideTrabalhador', [obrig('cpfTrab', t.cpf)]),
      obrig('alteracao', [
        obrig('dtAlteracao', data),
        obrig('dadosTrabalhador', [
          obrig('nmTrab', textoCampo(t.nome, 70)),
          obrig('sexo', f.sexo),
          obrig('racaCor', f.racaCor),
          el('estCiv', f.estadoCivil),
          obrig('grauInstr', f.grauInstrucao),
          el('nmSoc', textoCampo(f.nomeSocial, 70)),
          obrig('paisNac', f.paisNacionalidade),
          endereco(f),
        ]),
      ]),
    ],
    data,
  );
}

/** S-2206: alteração contratual (salário, cargo, jornada) na data. */
export function montarS2206(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  data: string,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasContrato(t, e).filter((x) => x.codigo !== 'sindicato-ausente');
  if (data < t.admissao) extras.push(pendencia('data-antes-admissao', 'A alteração é anterior à admissão.'));
  const p = comPendencias(e, extras);
  if (p) return p;
  return montar(
    'S-2206',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      ideVinculo(t),
      obrig('altContratual', [
        obrig('dtAlteracao', data),
        obrig('vinculo', [obrig('tpRegPrev', 1), infoContrato(t, cnpj)]),
      ]),
    ],
    data,
  );
}

/** S-2230: afastamento temporário (início e, se já houver, o fim no mesmo evento). */
export function montarS2230(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  a: AfastamentoParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasTrabalhador(t);
  const codigo = e.motivosAfastamento[String(a.motivo)] ?? null;
  if (!codigo)
    extras.push(
      pendencia(
        'motivo-sem-codigo',
        'O motivo do afastamento não tem o código do eSocial nos parâmetros do empregador.',
      ),
    );
  const p = comPendencias(e, extras);
  if (p) return p;
  return montar(
    'S-2230',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      obrig('ideVinculo', [obrig('cpfTrab', t.cpf), obrig('matricula', matriculaEsocial(t))]),
      obrig('infoAfastamento', [
        obrig('iniAfastamento', [obrig('dtIniAfast', a.inicio), obrig('codMotAfast', codigo!)]),
        a.fim ? obrig('fimAfastamento', [obrig('dtTermAfast', a.fim)]) : null,
      ]),
    ],
    a.inicio,
  );
}

/** As verbas da rescisão no S-2299: proventos e descontos com rubrica, valor positivo (bases e encargos ficam fora). */
export function verbasDaRescisao(
  linhas: readonly LinhaCalculoFolha[],
): { readonly codigo: string; readonly valor: number }[] {
  const porRubrica = new Map<string, number>();
  for (const l of linhas) {
    if (l.codigoRubrica === null || (l.tipo !== 'provento' && l.tipo !== 'desconto') || l.valor <= 0)
      continue;
    const c = String(l.codigoRubrica);
    porRubrica.set(c, (porRubrica.get(c) ?? 0) + l.valor);
  }
  return [...porRubrica.entries()]
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .map(([codigo, valor]) => ({ codigo, valor }));
}

/** S-2299: desligamento do empregado, com o aviso indenizado projetado e as verbas rescisórias da rescisão calculada. */
export function montarS2299(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  r: RescisaoParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasTrabalhador(t);
  if (t.ficha && !ehCategoriaEmpregado(t.ficha.categoria))
    extras.push(
      pendencia(
        'categoria-sem-vinculo',
        'A categoria do colaborador é de trabalhador sem vínculo: use o S-2399.',
      ),
    );
  const verbas = verbasDaRescisao(r.linhas);
  if (verbas.length > 200) extras.push(pendencia('verbas-demais', 'A rescisão tem mais de 200 rubricas.'));
  const p = comPendencias(e, extras);
  if (p) return p;
  const indenizado = r.diasIndenizados > 0;
  return montar(
    'S-2299',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      ideVinculo(t),
      obrig('infoDeslig', [
        obrig('mtvDeslig', MOTIVO_ESOCIAL_DA_MODALIDADE[r.modalidade]),
        obrig('dtDeslig', r.desligamento),
        obrig('indPagtoAPI', indenizado ? 'S' : 'N'),
        el('dtProjFimAPI', indenizado ? r.projecao : null),
        verbas.length
          ? obrig('verbasResc', [
              obrig('dmDev', [
                obrig('ideDmDev', `R${r.id}`),
                obrig('infoPerApur', [
                  obrig('ideEstabLot', [
                    obrig('tpInsc', 1),
                    obrig('nrInsc', cnpj),
                    obrig('codLotacao', e.codLotacao),
                    ...verbas.map((v) =>
                      obrig('detVerbas', [
                        obrig('codRubr', v.codigo),
                        obrig('ideTabRubr', e.ideTabRubr),
                        obrig('vrRubr', decimalDeCentavos(v.valor)),
                      ]),
                    ),
                  ]),
                ]),
              ]),
            ])
          : null,
      ]),
    ],
    r.desligamento,
  );
}

/** S-2300: início do trabalhador sem vínculo de emprego (estagiário, residente, cooperado…). */
export function montarS2300(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasTrabalhador(t);
  if (t.ficha && !ehCategoriaSemVinculo(t.ficha.categoria))
    extras.push(pendencia('categoria-empregado', 'A categoria do colaborador é de empregado: use o S-2200.'));
  const p = comPendencias(e, extras);
  if (p) return p;
  const f = t.ficha!;
  const estagio = f.categoria === '901' ? f.estagio : null;
  return montar(
    'S-2300',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      trabalhador(t),
      obrig('infoTSVInicio', [
        obrig('cadIni', 'N'),
        obrig('matricula', matriculaEsocial(t)),
        obrig('codCateg', f.categoria),
        obrig('dtInicio', t.admissao),
        el('natAtividade', f.naturezaAtividade),
        el('infoComplementares', [
          el('cargoFuncao', [el('nmCargo', textoCampo(t.cargo, 100)), el('CBOCargo', f.cboCargo)]),
          t.salario && t.salario > 0
            ? obrig('remuneracao', [obrig('vrSalFx', decimalDeCentavos(t.salario)), obrig('undSalFixo', 5)])
            : null,
          estagio
            ? obrig('infoEstagiario', [
                obrig('natEstagio', estagio.natureza),
                el('nivEstagio', estagio.nivel),
                obrig('dtPrevTerm', estagio.terminoPrevisto),
                obrig('instEnsino', [obrig('cnpjInstEnsino', estagio.cnpjInstituicao)]),
              ])
            : null,
          localTrabGeral(cnpj),
        ]),
      ]),
    ],
    t.admissao,
  );
}

/** S-2399: término do trabalhador sem vínculo na data. */
export function montarS2399(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  termino: string | null,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = pendenciasTrabalhador(t);
  if (!termino) extras.push(pendencia('termino-ausente', 'O vínculo não tem a data de término registrada.'));
  if (t.ficha && !ehCategoriaSemVinculo(t.ficha.categoria))
    extras.push(pendencia('categoria-empregado', 'A categoria do colaborador é de empregado: use o S-2299.'));
  const p = comPendencias(e, extras);
  if (p) return p;
  return montar(
    'S-2399',
    ctx,
    e,
    (cnpj) => [
      ideEventoTrabalhador(ctx, reciboRetificado),
      ideEmpregador(cnpj),
      obrig('ideTrabSemVinculo', [obrig('cpfTrab', t.cpf), obrig('matricula', matriculaEsocial(t))]),
      obrig('infoTSVTermino', [obrig('dtTerm', termino!)]),
    ],
    termino!,
  );
}

/** O evento a excluir pelo S-3000 (só aceito, com recibo). */
export interface EventoParaExclusao {
  readonly evento: string;
  readonly recibo: string | null;
  /** O CPF do trabalhador nos eventos do trabalhador; null nos de tabela. */
  readonly cpf: string | null;
  readonly dataReferencia: string;
  /** M53-F6: a apuração do periódico excluído (S-1200 e S-1210; o período é a data de referência). */
  readonly indApuracao?: 1 | 2 | null;
}

/** Periódicos que se excluem pelo S-3000 (com o CPF e o período); o S-1299 e o S-1298 não (reabre-se o período). */
const PERIODICOS_EXCLUIVEIS = ['S-1200', 'S-1210'];

/** S-3000: exclusão de um evento aceito (pelo recibo). Eventos de tabela não se excluem por aqui (a exclusão é deles). */
export function montarS3000(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  alvo: EventoParaExclusao,
  data: string,
): ResultadoEventoEsocial {
  const extras: PendenciaEsocial[] = [];
  if (!alvo.recibo) extras.push(pendencia('evento-sem-recibo', 'Só se exclui evento aceito, com recibo.'));
  const periodico = PERIODICOS_EXCLUIVEIS.includes(alvo.evento);
  if (/^S-1\d{3}$/.test(alvo.evento) && !periodico)
    extras.push(
      pendencia(
        'evento-de-tabela',
        'Evento de tabela se exclui pela operação de exclusão do próprio evento.',
      ),
    );
  if ((/^S-2/.test(alvo.evento) || periodico) && (!alvo.cpf || !/^\d{11}$/.test(alvo.cpf)))
    extras.push(pendencia('cpf-ausente', 'O CPF do trabalhador do evento não pôde ser lido.'));
  const p = comPendencias(e, extras);
  if (p) return p;
  return montar(
    'S-3000',
    ctx,
    e,
    (cnpj) => [
      ideEventoTabela(ctx),
      ideEmpregador(cnpj),
      obrig('infoExclusao', [
        obrig('tpEvento', alvo.evento),
        obrig('nrRecEvt', alvo.recibo!),
        alvo.cpf ? obrig('ideTrabalhador', [obrig('cpfTrab', alvo.cpf)]) : null,
        periodico
          ? obrig('ideFolhaPagto', [
              alvo.evento === 'S-1200' ? obrig('indApuracao', alvo.indApuracao ?? 1) : null,
              obrig('perApur', alvo.dataReferencia),
            ])
          : null,
      ]),
    ],
    data,
  );
}
