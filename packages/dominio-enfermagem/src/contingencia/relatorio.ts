// Relatório de contingência por posto (ficha do M40, regra 6; cap-14 §14.8 e §14.8.1): o que a enfermagem do posto
// precisa no papel se o sistema novo parar — pacientes por leito, alergias, prescrição vigente, horários aprazados das
// próximas horas e os registros que só existem no novo (sinais vitais, lista de problemas, justificativas de alerta,
// rastreio de amostra e etapas da higienização). Regras puras: quem lê o banco é o chamador; a saída vai ao modelo do
// documento (PDF/A, M09). Dado de paciente: nada daqui vai a log.
import {
  ESTADOS_AMOSTRA,
  ETAPAS_LIMPEZA,
  type PacienteContingencia,
  type RelatorioContingencia,
  SINAIS_VITAIS,
} from '@sgh/contratos';

export interface InternadoContingencia {
  readonly paciente: number;
  readonly atendimento: number;
  readonly nome: string;
  readonly leito: string;
  readonly alergia: boolean;
}

export interface HorarioContingencia {
  readonly atendimento: number;
  readonly prescricao: number;
  /** AAAA-MM-DDTHH:mm:ss (hora local do banco). */
  readonly previsto: string;
  /** Situação do horário: P = pendente (só os pendentes entram no horizonte). */
  readonly situacao: string;
  readonly descricao: string;
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  readonly seNecessario: boolean;
}

export interface LeituraContingencia {
  readonly unidade: string;
  /** Relógio do banco (AAAA-MM-DDTHH:mm:ss). */
  readonly agora: string;
  readonly horas: number;
  readonly internados: readonly InternadoContingencia[];
  readonly alergias: ReadonlyMap<number, readonly string[]>;
  readonly horarios: readonly HorarioContingencia[];
  readonly cortado: boolean;
  readonly sinais: readonly {
    readonly paciente: number;
    readonly tipo: string;
    readonly valor: number;
    readonly unidade: string;
    readonly horaReal: string;
  }[];
  readonly problemas: readonly {
    readonly paciente: number;
    readonly descricao: string;
    readonly cid: string | null;
  }[];
  readonly justificativas: readonly { readonly prescricao: number; readonly texto: string }[];
  readonly amostras: readonly {
    readonly atendimento: number;
    readonly codigo: string;
    readonly estado: string;
  }[];
  readonly limpezas: readonly {
    readonly leito: string;
    readonly etapa: string;
    readonly prazo: string | null;
  }[];
  /** Pacientes cujas alergias, problemas e amostras não foram lidos (teto da leitura). */
  readonly naoLidos?: readonly number[];
}

const minuto = (x: string) => x.slice(0, 16);
const somarHoras = (x: string, h: number) => {
  const d = new Date(`${x.slice(0, 19)}Z`);
  return new Date(d.getTime() + h * 3_600_000).toISOString().slice(0, 19);
};

/** O item da prescrição como a enfermagem lê (descrição, dose e via; "se necessário" marcado). */
export function itemDaPrescricao(
  h: Pick<HorarioContingencia, 'descricao' | 'dose' | 'unidadeDose' | 'via' | 'seNecessario'>,
) {
  const dose =
    h.dose !== null ? ` ${String(h.dose).replace('.', ',')}${h.unidadeDose ? ` ${h.unidadeDose}` : ''}` : '';
  return `${h.descricao.trim()}${dose}${h.via ? `, ${h.via}` : ''}${h.seNecessario ? ' (se necessário)' : ''}`;
}

const rotuloSinal = (tipo: string) =>
  (SINAIS_VITAIS as Record<string, { rotulo: string } | undefined>)[tipo]?.rotulo ?? tipo;
const rotuloAmostra = (e: string) => ESTADOS_AMOSTRA.find((x) => x.codigo === e)?.rotulo ?? e;
const rotuloEtapa = (e: string) => ETAPAS_LIMPEZA.find((x) => x.codigo === e)?.rotulo ?? e;

/**
 * Monta o relatório do posto: um bloco por paciente, na ordem dos leitos; o horizonte é de agora até `horas` adiante
 * (os pendentes atrasados das 2 horas anteriores também entram, marcados pelo horário). A prescrição vigente são os
 * itens com horário na leitura (o chamador lê as últimas 24 horas e o horizonte). Sinais: o último de cada tipo nas
 * 24 horas. Nenhuma contagem é inventada: o que a leitura não trouxe não aparece.
 */
export function montarRelatorioContingencia(l: LeituraContingencia): RelatorioContingencia {
  const ate = somarHoras(l.agora, l.horas);
  // Os atrasados das últimas 2 horas também entram (o que ficou para trás no momento da parada).
  const desde = somarHoras(l.agora, -2);
  const naoLidos = new Set(l.naoLidos ?? []);
  const pacientes: PacienteContingencia[] = [...l.internados]
    .sort(
      (a, b) => a.leito.localeCompare(b.leito, 'pt-BR', { numeric: true }) || a.atendimento - b.atendimento,
    )
    .map((i) => {
      const doAtd = l.horarios.filter((h) => h.atendimento === i.atendimento);
      const prescricoes = new Set(doAtd.map((h) => h.prescricao));
      const prescricao = [...new Set(doAtd.map(itemDaPrescricao))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      );
      const horarios = doAtd
        .filter(
          (h) =>
            h.situacao === 'P' && minuto(h.previsto) >= minuto(desde) && minuto(h.previsto) <= minuto(ate),
        )
        .sort((a, b) => a.previsto.localeCompare(b.previsto))
        .map((h) => ({ previsto: minuto(h.previsto), descricao: itemDaPrescricao(h) }));
      const ultimo = new Map<string, LeituraContingencia['sinais'][number]>();
      for (const s of l.sinais.filter((x) => x.paciente === i.paciente)) {
        const atual = ultimo.get(s.tipo);
        if (!atual || s.horaReal > atual.horaReal) ultimo.set(s.tipo, s);
      }
      const sinais = [...ultimo.values()]
        .sort((a, b) => a.tipo.localeCompare(b.tipo))
        .map((s) => ({
          tipo: rotuloSinal(s.tipo),
          valor: `${String(s.valor).replace('.', ',')} ${s.unidade}`.trim(),
          em: minuto(s.horaReal),
        }));
      const alergias = [...(l.alergias.get(i.paciente) ?? [])];
      return {
        leito: i.leito,
        nome: i.nome,
        atendimento: i.atendimento,
        alergias,
        temAlergia: i.alergia || alergias.length > 0,
        prescricao,
        horarios,
        sinais,
        problemas: l.problemas
          .filter((p) => p.paciente === i.paciente)
          .map((p) => (p.cid ? `${p.descricao} (${p.cid})` : p.descricao)),
        justificativas: l.justificativas.filter((j) => prescricoes.has(j.prescricao)).map((j) => j.texto),
        amostras: l.amostras
          .filter((a) => a.atendimento === i.atendimento)
          .map((a) => ({ codigo: a.codigo, estado: rotuloAmostra(a.estado) })),
        ...(naoLidos.has(i.paciente) ? { extrasNaoLidos: true } : {}),
      };
    });
  const extrasCortados = pacientes.filter((p) => p.extrasNaoLidos).length;
  return {
    unidade: l.unidade,
    geradoEm: minuto(l.agora),
    horizonte: { de: minuto(l.agora), ate: minuto(ate) },
    pacientes,
    limpezas: l.limpezas.map((x) => ({
      ...x,
      etapa: rotuloEtapa(x.etapa),
      prazo: x.prazo ? minuto(x.prazo) : null,
    })),
    cortado: l.cortado || extrasCortados > 0,
    ...(extrasCortados > 0 ? { extrasCortados } : {}),
  };
}

const br = (x: string) => {
  const [d, h] = x.split('T');
  const [a, m, dia] = (d ?? '').split('-');
  return `${dia}/${m}/${a}${h ? ` ${h.slice(0, 5)}` : ''}`;
};
const hora = (x: string) => x.slice(11, 16);

/**
 * As linhas do documento (rótulo e valor), para o modelo HTML do M09: o cabeçalho do posto e, por paciente, o leito
 * com o nome, as alergias, a prescrição, os horários e os registros do novo. Vazio vira "nenhum registro".
 */
export function camposDoRelatorioContingencia(r: RelatorioContingencia): { rotulo: string; valor: string }[] {
  const nada = 'nenhum registro';
  const linhas: { rotulo: string; valor: string }[] = [
    { rotulo: 'Posto (unidade)', valor: r.unidade },
    { rotulo: 'Horizonte', valor: `${br(r.horizonte.de)} a ${br(r.horizonte.ate)}` },
    { rotulo: 'Pacientes', valor: String(r.pacientes.length) },
  ];
  const extrasCortados = r.extrasCortados ?? 0;
  if (r.cortado && extrasCortados === 0)
    linhas.push({
      rotulo: 'Atenção',
      valor: 'A leitura dos horários atingiu o teto: consulte a prescrição de cada paciente.',
    });
  if (extrasCortados > 0)
    linhas.push({
      rotulo: 'Atenção',
      valor: `A leitura atingiu o teto: alergias, lista de problemas e amostras de ${extrasCortados} paciente(s) não foram lidas (marcados "não lido"); consulte o prontuário de cada um.`,
    });
  const naoLido = 'não lido: consulte o prontuário';
  for (const p of r.pacientes) {
    const semLeitura = p.extrasNaoLidos === true;
    linhas.push(
      { rotulo: `Leito ${p.leito}`, valor: `${p.nome} (atendimento ${p.atendimento})` },
      {
        rotulo: 'Alergias',
        valor: p.alergias.length
          ? p.alergias.join('; ')
          : semLeitura
            ? p.temAlergia
              ? `alergia registrada; ${naoLido}`
              : naoLido
            : p.temAlergia
              ? 'alergia registrada (sem o nome no cadastro)'
              : 'nenhuma registrada',
      },
      { rotulo: 'Prescrição vigente', valor: p.prescricao.length ? p.prescricao.join('; ') : nada },
      {
        rotulo: 'Horários aprazados',
        valor: p.horarios.length
          ? p.horarios.map((h) => `${hora(h.previsto)} ${h.descricao}`).join('; ')
          : nada,
      },
      {
        rotulo: 'Sinais vitais (últimos)',
        valor: p.sinais.length
          ? p.sinais.map((s) => `${s.tipo} ${s.valor} às ${hora(s.em)}`).join('; ')
          : nada,
      },
      {
        rotulo: 'Lista de problemas',
        valor: p.problemas.length ? p.problemas.join('; ') : semLeitura ? naoLido : nada,
      },
    );
    if (p.justificativas.length)
      linhas.push({ rotulo: 'Justificativas de alerta', valor: p.justificativas.join('; ') });
    if (p.amostras.length)
      linhas.push({
        rotulo: 'Amostras em rastreio',
        valor: p.amostras.map((a) => `${a.codigo} ${a.estado}`).join('; '),
      });
    else if (semLeitura) linhas.push({ rotulo: 'Amostras em rastreio', valor: naoLido });
  }
  linhas.push({
    rotulo: 'Higienização em andamento',
    valor: r.limpezas.length
      ? r.limpezas
          .map((x) => `leito ${x.leito}: ${x.etapa}${x.prazo ? ` (prazo ${hora(x.prazo)})` : ''}`)
          .join('; ')
      : nada,
  });
  return linhas;
}
