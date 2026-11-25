import { describe, expect, it } from 'vitest';
import {
  chaveEspecialidade,
  type EspecialidadeEntrada,
  type LocalAtendimentoEntrada,
  problemasDaEspecialidade,
  problemasDaQualificacao,
  problemasDaReativacaoPrestador,
  problemasDaSuspensao,
  problemasDoDesligamento,
  problemasDoLocal,
  qualificacaoVigente,
  situacaoDaSuspensao,
  situacaoDoDescredenciamento,
} from './rede-cadastro.js';

const cods = (r: { codigo: string }[]) => r.map((x) => x.codigo);
const local: LocalAtendimentoEntrada = {
  nome: 'Unidade Centro',
  cnes: '9021001',
  cep: '01310-100',
  logradouro: 'Avenida Sintética',
  numero: '100',
  complemento: null,
  bairro: null,
  municipioIbge: 3550308,
  latitude: -23.5,
  longitude: -46.6,
  telefone: null,
  email: 'local@exemplo.test',
  acessivelCadeirante: true,
  estacionamento: false,
  principal: true,
  divulga: true,
};
const esp: EspecialidadeEntrada = {
  especialidade: 7,
  local: 1,
  ambulatorio: true,
  internacao: false,
  urgencia: false,
  hospitalDia: false,
  adulto: true,
  pediatrico: false,
  rqe: '12345',
  principal: true,
  divulga: true,
};

describe('local de atendimento', () => {
  it('aceita o local completo (CEP com máscara)', () => expect(problemasDoLocal(local)).toEqual([]));
  it('recusa CEP, logradouro, município, CNES, coordenadas e e-mail inválidos', () => {
    expect(
      cods(
        problemasDoLocal({
          ...local,
          cep: '0131',
          logradouro: ' ',
          municipioIbge: 35,
          cnes: '12',
          latitude: 91,
          longitude: null,
          email: 'x@',
        }),
      ),
    ).toEqual([
      'cep-invalido',
      'logradouro-obrigatorio',
      'municipio-invalido',
      'cnes-invalido',
      'latitude-invalida',
      'coordenada-incompleta',
      'email-invalido',
    ]);
  });
  it('desligamento: motivo, data e especialidades só do local', () => {
    expect(
      problemasDoDesligamento(
        { ativo: true, especialidadesAtivas: 0 },
        { desligadoEm: '2026-12-01', motivo: 'Mudança de endereço' },
        '2026-11-25',
      ),
    ).toEqual([]);
    expect(
      cods(
        problemasDoDesligamento(
          { ativo: false, especialidadesAtivas: 2 },
          { desligadoEm: '2026-11-01', motivo: 'curto' },
          '2026-11-25',
        ),
      ),
    ).toEqual(['local-ja-desligado', 'motivo-curto', 'desligamento-no-passado', 'local-com-especialidades']);
  });
});

describe('especialidade atendida', () => {
  const ctx = { pessoa: 'F' as const, locaisAtivos: new Set([1]), jaAtivas: new Set<string>() };
  it('aceita a especialidade com regime, público, local ativo e RQE', () =>
    expect(problemasDaEspecialidade(esp, ctx)).toEqual([]));
  it('recusa sem regime, sem público, local alheio e repetida', () => {
    expect(
      cods(
        problemasDaEspecialidade(
          { ...esp, ambulatorio: false, adulto: false, local: 9 },
          { ...ctx, jaAtivas: new Set([chaveEspecialidade(7, 9)]) },
        ),
      ),
    ).toEqual(['regime-obrigatorio', 'publico-obrigatorio', 'local-invalido', 'especialidade-repetida']);
  });
  it('pessoa física divulgada como especialista exige RQE; pessoa jurídica não', () => {
    expect(cods(problemasDaEspecialidade({ ...esp, rqe: null }, ctx))).toEqual([
      'rqe-obrigatorio-para-divulgar',
    ]);
    expect(problemasDaEspecialidade({ ...esp, rqe: null, divulga: false }, ctx)).toEqual([]);
    expect(problemasDaEspecialidade({ ...esp, rqe: null }, { ...ctx, pessoa: 'J' })).toEqual([]);
    expect(cods(problemasDaEspecialidade({ ...esp, rqe: 'RQE 12' }, ctx))).toEqual(['rqe-invalido']);
  });
  it('a mesma especialidade em outro local ou em todos é outra chave', () => {
    const j = { ...ctx, jaAtivas: new Set([chaveEspecialidade(7, 1)]) };
    expect(problemasDaEspecialidade({ ...esp, local: null }, j)).toEqual([]);
  });
});

describe('qualificação divulgada', () => {
  const atr = {
    id: 3,
    pessoaFisica: false,
    pessoaJuridica: false,
    hospital: true,
    vigenciaInicio: '2020-01-01',
    vigenciaFim: null,
  };
  const q = {
    atributo: 3,
    nivel: 'pleno',
    titulo: null,
    divulga: true,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2028-12-31',
  };
  it('atributo de hospital vale para o hospital', () =>
    expect(problemasDaQualificacao(q, atr, { pessoa: 'J', hospitalar: true }, new Set())).toEqual([]));
  it('recusa atributo que não se aplica, fora da vigência, invertido e repetido', () => {
    expect(
      cods(
        problemasDaQualificacao(
          { ...q, vigenciaInicio: '2019-01-01', vigenciaFim: '2018-01-01' },
          atr,
          { pessoa: 'J', hospitalar: false },
          new Set([3]),
        ),
      ),
    ).toEqual([
      'atributo-nao-aplica',
      'atributo-fora-da-vigencia',
      'vigencia-invertida',
      'qualificacao-repetida',
    ]);
    expect(cods(problemasDaQualificacao(q, null, { pessoa: 'F', hospitalar: false }, new Set()))).toEqual([
      'atributo-inexistente',
    ]);
  });
  it('vigente só quando divulga e dentro da validade', () => {
    expect(qualificacaoVigente(q, '2027-06-01')).toBe(true);
    expect(qualificacaoVigente(q, '2029-01-01')).toBe(false);
    expect(qualificacaoVigente({ ...q, divulga: false }, '2027-06-01')).toBe(false);
  });
});

describe('suspensão', () => {
  const c = { credenciado: true, locaisAtivos: new Set([1, 2]), abertas: [] as (number | null)[] };
  const s = {
    motivo: 'auditoria',
    local: null,
    desde: '2026-11-25',
    reativacaoPrevista: '2026-12-31',
    observacao: null,
  };
  it('aceita a suspensão do prestador inteiro', () =>
    expect(problemasDaSuspensao(s, c, '2026-11-25')).toEqual([]));
  it('recusa motivo, prestador fora, local alheio, passado, reativação antes e "outro" sem descrição', () => {
    expect(
      cods(
        problemasDaSuspensao(
          { ...s, motivo: 'outro', local: 9, desde: '2026-11-01', reativacaoPrevista: '2026-10-01' },
          { ...c, credenciado: false },
          '2026-11-25',
        ),
      ),
    ).toEqual([
      'prestador-fora-da-rede',
      'local-invalido',
      'suspensao-no-passado',
      'reativacao-antes-do-inicio',
      'observacao-obrigatoria',
    ]);
    expect(cods(problemasDaSuspensao({ ...s, motivo: 'xx' }, c, '2026-11-25'))).toEqual(['motivo-invalido']);
  });
  it('não abre suspensão sobreposta (inteira sobre local, local sobre inteira, mesmo local)', () => {
    expect(cods(problemasDaSuspensao(s, { ...c, abertas: [1] }, '2026-11-25'))).toEqual(['suspensao-aberta']);
    expect(cods(problemasDaSuspensao({ ...s, local: 1 }, { ...c, abertas: [null] }, '2026-11-25'))).toEqual([
      'suspensao-aberta',
    ]);
    expect(cods(problemasDaSuspensao({ ...s, local: 1 }, { ...c, abertas: [1] }, '2026-11-25'))).toEqual([
      'suspensao-aberta',
    ]);
    expect(problemasDaSuspensao({ ...s, local: 2 }, { ...c, abertas: [1] }, '2026-11-25')).toEqual([]);
  });
  it('situação pelas datas e reativação', () => {
    expect(situacaoDaSuspensao('2026-12-01', null, '2026-11-25')).toBe('programada');
    expect(situacaoDaSuspensao('2026-11-01', null, '2026-11-25')).toBe('ativa');
    expect(situacaoDaSuspensao('2026-11-01', '2026-11-20', '2026-11-25')).toBe('encerrada');
    expect(
      problemasDaReativacaoPrestador({ desde: '2026-11-01', situacao: 'ativa' }, '2026-11-25', '2026-11-25'),
    ).toEqual([]);
    expect(
      problemasDaReativacaoPrestador(
        { desde: '2026-12-10', situacao: 'programada' },
        '2026-11-25',
        '2026-11-25',
      ),
    ).toEqual([]);
    expect(
      cods(
        problemasDaReativacaoPrestador(
          { desde: '2026-11-01', situacao: 'encerrada' },
          '2026-11-20',
          '2026-11-25',
        ),
      ),
    ).toEqual(['suspensao-encerrada', 'reativacao-no-passado']);
  });
  it('descredenciamento agendado ou efetivado pela data', () => {
    expect(situacaoDoDescredenciamento('2026-12-30', '2026-11-25')).toBe('agendado');
    expect(situacaoDoDescredenciamento('2026-11-25', '2026-11-25')).toBe('efetivado');
  });
});
