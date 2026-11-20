<script setup lang="ts">
// Acompanhamento da competência (ficha do M42, campos 4 e 7): seção do painel de glosas e ciclo de receita. A
// competência inteira, feita neste sistema e conferida no outro: contas por situação e por sistema que fechou (toda soma
// com as parcelas), lotes e protocolos, glosas e recursos, títulos e movimento do mês, repasse, gravações deste sistema
// por operação da onda e quem ainda usa o outro sistema nos grupos da onda (só contagens; abaixo de 5, "<5"). O bloco
// sem a leitura do setor mostra o motivo, nunca zero. A conferência compara o que o chave-usuário leu no relatório do
// outro sistema com o lido agora: nada grava.
import type { ConferenciaCompetencia } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import {
  conferirCompetencia,
  lerAcompanhamento,
  novaChave,
  urlExportacaoAcompanhamento,
} from '../api-tiss.js';
import { competenciaAtual, numero, opcoesConvenio, quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const { apoio } = usarTiss('glosa');
const mes = ref(competenciaAtual(undefined));
const convenio = ref('');
const filtro = ref<{ competencia: string; convenio?: string }>({ competencia: mes.value });
const p = useQuery({
  queryKey: computed(() => ['tiss', 'acompanhamento', filtro.value]),
  queryFn: () => lerAcompanhamento(filtro.value),
});
const opcoes = computed(() =>
  opcoesConvenio(
    apoio.data.value?.convenios ??
      p.data.value?.contas.porConvenio.map((c) => ({ codigo: c.convenio, nome: c.nome })),
    t('tiss.acompanhamento.todosConvenios'),
  ),
);
function aplicar(): void {
  filtro.value = { competencia: mes.value, ...(convenio.value ? { convenio: convenio.value } : {}) };
}
const pct = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const contagem = (n: number) => (n > 0 && n < 5 ? t('tiss.acompanhamento.uso.poucos') : String(n));

// ── Conferência com o outro sistema ──────────────────────────────────────────────────────────────────────
// Os campos começam vazios e só guardam o que o chave-usuário digitou a partir do relatório do outro sistema (nunca uma
// cópia do lido aqui). O convênio deixado em branco conta como diferença ("só de um lado"); o convênio que só o outro
// sistema tem entra pela lista com busca. Cada bloco vai inteiro ou não vai: o bloco começado e não terminado é avisado.
type Campos = Record<string, string>;
const vazio = (campos: readonly string[]): Campos => Object.fromEntries(campos.map((c) => [c, '']));
const CAMPOS_BLOCO = {
  lotes: ['lotes', 'protocolados'],
  glosas: ['emitido', 'glosa', 'recuperado'],
  aPagar: ['titulos', 'valor'],
  aReceber: ['titulos', 'valor'],
  repasse: ['eventos', 'valorEventos', 'rpas'],
} as const;
type BlocoSimples = keyof typeof CAMPOS_BLOCO;
const INTEIROS = new Set([
  'contas',
  'fechadas',
  'lotes',
  'protocolados',
  'titulos',
  'eventos',
  'rpas',
  'lancamentos',
]);
const informado = reactive<Record<number, Campos>>({});
const blocos = reactive<Record<BlocoSimples, Campos>>({
  lotes: vazio(CAMPOS_BLOCO.lotes),
  glosas: vazio(CAMPOS_BLOCO.glosas),
  aPagar: vazio(CAMPOS_BLOCO.aPagar),
  aReceber: vazio(CAMPOS_BLOCO.aReceber),
  repasse: vazio(CAMPOS_BLOCO.repasse),
});
const movimentoInf = reactive<Record<string, Campos>>({});
const acrescentados = ref<number[]>([]);
const tiposAcrescentados = ref<string[]>([]);
const novoConvenio = ref('');
const novoTipo = ref('');
const nomeConvenio = (codigo: number) =>
  p.data.value?.contas.porConvenio.find((c) => c.convenio === codigo)?.nome ??
  apoio.data.value?.convenios.find((c) => c.codigo === codigo)?.nome ??
  t('tiss.acompanhamento.conferencia.convenioN', { n: codigo });
const conveniosConf = computed(() => [
  ...new Set([...(p.data.value?.contas.porConvenio.map((c) => c.convenio) ?? []), ...acrescentados.value]),
]);
const opcoesAcrescentar = computed(() =>
  opcoesConvenio((apoio.data.value?.convenios ?? []).filter((c) => !conveniosConf.value.includes(c.codigo))),
);
const tiposConf = computed(() => {
  const ti = p.data.value?.titulos;
  const lidos = ti && ti.disponivel && ti.movimento ? ti.movimento.map((m) => m.tipo) : [];
  return [...new Set([...lidos, ...tiposAcrescentados.value])];
});
const rotuloTipo = (tipo: string) => {
  const ti = p.data.value?.titulos;
  return (
    (ti && ti.disponivel ? ti.movimento?.find((m) => m.tipo === tipo)?.rotulo : undefined) ??
    t('tiss.acompanhamento.conferencia.tipoN', { tipo: tipo || '—' })
  );
};
watch(
  [conveniosConf, tiposConf],
  ([convs, tipos]) => {
    for (const c of convs) informado[c] ??= vazio(['contas', 'fechadas', 'valor']);
    for (const x of tipos) movimentoInf[x] ??= vazio(['lancamentos', 'valor']);
  },
  { immediate: true },
);
function acrescentarConvenio(): void {
  const n = Number(novoConvenio.value);
  if (Number.isInteger(n) && n > 0 && !conveniosConf.value.includes(n)) acrescentados.value.push(n);
  novoConvenio.value = '';
}
function acrescentarTipo(): void {
  const x = novoTipo.value.trim().toUpperCase().slice(0, 5);
  if (!tiposConf.value.includes(x)) tiposAcrescentados.value.push(x);
  novoTipo.value = '';
}
function limpar(): void {
  for (const k of Object.keys(informado)) informado[Number(k)] = vazio(['contas', 'fechadas', 'valor']);
  for (const b of Object.keys(CAMPOS_BLOCO) as BlocoSimples[]) blocos[b] = vazio(CAMPOS_BLOCO[b]);
  for (const k of Object.keys(movimentoInf)) movimentoInf[k] = vazio(['lancamentos', 'valor']);
  acrescentados.value = [];
  tiposAcrescentados.value = [];
  resultado.value = null;
  erroConf.value = null;
}
const cheio = (x: Campos | undefined) => !!x && Object.values(x).every((v) => v.trim() !== '');
const comecado = (x: Campos | undefined) => !!x && Object.values(x).some((v) => v.trim() !== '');
const valores = (x: Campos) =>
  Object.fromEntries(
    Object.entries(x).map(([k, v]) => [k, INTEIROS.has(k) ? Math.trunc(numero(v)) : numero(v)]),
  );
/** Os blocos começados e não terminados (o aviso antes de conferir). */
const incompletos = computed(() => [
  ...conveniosConf.value
    .filter((c) => comecado(informado[c]) && !cheio(informado[c]))
    .map((c) => `${c} — ${nomeConvenio(c)}`),
  ...(Object.keys(CAMPOS_BLOCO) as BlocoSimples[])
    .filter((b) => comecado(blocos[b]) && !cheio(blocos[b]))
    .map((b) => t(`tiss.acompanhamento.conferencia.blocos.${b}`)),
  ...tiposConf.value
    .filter((x) => comecado(movimentoInf[x]) && !cheio(movimentoInf[x]))
    .map((x) => rotuloTipo(x)),
]);
const algumPreenchido = computed(
  () =>
    conveniosConf.value.some((c) => cheio(informado[c])) ||
    (Object.keys(CAMPOS_BLOCO) as BlocoSimples[]).some((b) => cheio(blocos[b])) ||
    tiposConf.value.some((x) => cheio(movimentoInf[x])),
);
const resultado = ref<ConferenciaCompetencia | null>(null);
const erroConf = ref<unknown>(null);
async function conferir(): Promise<void> {
  erroConf.value = null;
  resultado.value = null;
  if (incompletos.value.length > 0 || !algumPreenchido.value) return;
  const linhas = conveniosConf.value
    .filter((c) => cheio(informado[c]))
    .map(
      (c) =>
        ({ convenio: c, ...valores(informado[c]!) }) as {
          convenio: number;
          contas: number;
          fechadas: number;
          valor: number;
        },
    );
  const mov = tiposConf.value
    .filter((x) => cheio(movimentoInf[x]))
    .map(
      (x) =>
        ({ tipo: x, ...valores(movimentoInf[x]!) }) as { tipo: string; lancamentos: number; valor: number },
    );
  const simples = Object.fromEntries(
    (Object.keys(CAMPOS_BLOCO) as BlocoSimples[])
      .filter((b) => cheio(blocos[b]))
      .map((b) => [b, valores(blocos[b])]),
  );
  try {
    resultado.value = await conferirCompetencia(
      {
        competencia: p.data.value!.competencia,
        // As contas vão quando ao menos um convênio foi informado: os em branco contam como diferença no servidor.
        ...(linhas.length > 0 ? { linhas } : {}),
        blocos: { ...simples, ...(mov.length > 0 ? { movimento: mov } : {}) },
      },
      novaChave('conferencia-competencia'),
    );
  } catch (e) {
    erroConf.value = e;
  }
}
/** A chave da diferença com o nome de produto (o convênio pelo nome; o bloco pelo rótulo). */
function rotuloChave(chave: string): string {
  const conv = /^convenio (\d+)$/.exec(chave);
  if (conv) return `${conv[1]} — ${nomeConvenio(Number(conv[1]))}`;
  const mov = /^movimento (.*)$/.exec(chave);
  if (mov) return `${t('tiss.acompanhamento.conferencia.blocos.movimento')}: ${rotuloTipo(mov[1] ?? '')}`;
  const bloco = {
    lotes: 'lotes',
    glosas: 'glosas',
    'titulos a pagar': 'aPagar',
    'titulos a receber': 'aReceber',
    repasse: 'repasse',
  }[chave];
  return bloco ? t(`tiss.acompanhamento.conferencia.blocos.${bloco}`) : chave;
}
const rotuloCampo = (campo: string) =>
  campo === 'presenca'
    ? t('tiss.acompanhamento.diferencas.presenca')
    : t(`tiss.acompanhamento.conferencia.campos.${campo}`);
const valorDiferenca = (v: number | string | null) =>
  v === null ? '—' : v === 'presente' ? t('tiss.acompanhamento.diferencas.presente') : String(v);
</script>

<template>
  <section class="painel" aria-labelledby="ac-titulo" data-testid="painel-acompanhamento">
    <h2 id="ac-titulo">{{ t('tiss.acompanhamento.titulo') }}</h2>
    <p>{{ t('tiss.acompanhamento.texto') }}</p>
    <form class="filtros" @submit.prevent="aplicar">
      <span class="campo">
        <label for="ac-competencia">{{ t('tiss.acompanhamento.competencia') }}</label>
        <input id="ac-competencia" v-model="mes" type="month" required data-testid="ac-competencia" />
      </span>
      <SanteSelecao
        id="ac-convenio"
        v-model="convenio"
        :rotulo="t('tiss.acompanhamento.convenio')"
        :opcoes="opcoes"
        busca
        data-testid="ac-convenio"
      />
      <SanteBotao tipo="submit" :rotulo="t('tiss.acompanhamento.aplicar')" data-testid="ac-aplicar" />
      <a :href="urlExportacaoAcompanhamento(filtro)" data-testid="ac-exportar">{{
        t('tiss.acompanhamento.exportar')
      }}</a>
    </form>
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="ac-lido">
        {{
          p.data.value.emCache
            ? t('tiss.acompanhamento.emCache', { em: quando(p.data.value.geradoEm) })
            : t('tiss.acompanhamento.agora')
        }}
      </p>

      <h3>{{ t('tiss.acompanhamento.contas.titulo') }}</h3>
      <dl class="resumo" data-testid="ac-contas">
        <dt>{{ t('tiss.acompanhamento.contasN') }}</dt>
        <dd data-testid="ac-contas-total">
          {{
            t('tiss.acompanhamento.contas.total', {
              contas: p.data.value.contas.contas,
              valor: reais(p.data.value.contas.valor),
            })
          }}
          =
          {{
            p.data.value.contas.porSituacao
              .map((x) => `${x.contas} ${x.rotulo.toLowerCase()} (${reais(x.valor)})`)
              .join(' + ')
          }}
        </dd>
        <dt>{{ t('tiss.acompanhamento.contas.situacao.S') }}</dt>
        <dd data-testid="ac-fechadas">
          {{
            t('tiss.acompanhamento.contas.fechadas', {
              fechadas: p.data.value.contas.fechadas,
              novo: p.data.value.contas.fechadasPeloNovo,
              outro: p.data.value.contas.fechadasPeloOutro,
            })
          }}
        </dd>
        <dt>{{ t('tiss.acompanhamento.contas.parcelaRotulo') }}</dt>
        <dd data-testid="ac-parcela">
          {{
            p.data.value.contas.parcelaDoNovo === null
              ? t('tiss.acompanhamento.contas.semFechada')
              : pct(p.data.value.contas.parcelaDoNovo)
          }}
        </dd>
      </dl>
      <table class="tabela" data-testid="ac-convenios">
        <caption>
          {{
            t('tiss.acompanhamento.porConvenio')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.acompanhamento.convenio') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.contasN') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.fechadasConvenio') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.fechadasNovo') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in p.data.value.contas.porConvenio" :key="c.convenio">
            <td>{{ c.convenio }} — {{ c.nome }}</td>
            <td>{{ c.contas }}</td>
            <td>{{ c.fechadas }}</td>
            <td>{{ c.fechadasPeloNovo }}</td>
            <td>{{ reais(c.valor) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('tiss.acompanhamento.lotes.titulo') }}</h3>
      <ul data-testid="ac-lotes">
        <li>
          {{ t('tiss.acompanhamento.lotes.lotes', { lotes: p.data.value.lotes.lotes }) }} =
          {{
            t('tiss.acompanhamento.lotes.protocolo', {
              com: p.data.value.lotes.comProtocolo,
              sem: p.data.value.lotes.semProtocolo,
            })
          }}
        </li>
        <li>{{ t('tiss.acompanhamento.lotes.contasEmLote', { n: p.data.value.lotes.contasEmLote }) }}</li>
        <li>
          {{
            t('tiss.acompanhamento.lotes.competencias', {
              fechados: p.data.value.lotes.conveniosFechados,
              comConta: p.data.value.lotes.conveniosComConta,
            })
          }}
        </li>
      </ul>

      <h3>{{ t('tiss.acompanhamento.glosas.titulo') }}</h3>
      <p v-if="!p.data.value.glosas.disponivel" data-testid="ac-glosas-indisponivel">
        {{ p.data.value.glosas.motivo }}
      </p>
      <dl v-else class="resumo" data-testid="ac-glosas">
        <dt>{{ t('tiss.acompanhamento.glosas.emitido') }}</dt>
        <dd>{{ reais(p.data.value.glosas.emitido) }}</dd>
        <dt>{{ t('tiss.acompanhamento.glosas.glosa') }}</dt>
        <dd>{{ reais(p.data.value.glosas.glosa) }}</dd>
        <dt>{{ t('tiss.acompanhamento.glosas.contestado') }}</dt>
        <dd>{{ reais(p.data.value.glosas.contestado) }}</dd>
        <dt>{{ t('tiss.acompanhamento.glosas.recuperado') }}</dt>
        <dd>{{ reais(p.data.value.glosas.recuperado) }}</dd>
        <dt>{{ t('tiss.acompanhamento.glosas.exito') }}</dt>
        <dd>{{ p.data.value.glosas.exitoRotulo }}</dd>
      </dl>

      <h3>{{ t('tiss.acompanhamento.titulos.titulo') }}</h3>
      <p v-if="!p.data.value.titulos.disponivel" data-testid="ac-titulos-indisponivel">
        {{ p.data.value.titulos.motivo }}
      </p>
      <template v-else>
        <ul data-testid="ac-titulos">
          <li>
            {{
              p.data.value.titulos.aPagar
                ? t('tiss.acompanhamento.titulos.aPagar', {
                    titulos: p.data.value.titulos.aPagar.titulos,
                    valor: reais(p.data.value.titulos.aPagar.valor),
                    pagos: p.data.value.titulos.aPagar.pagos,
                    valorPago: reais(p.data.value.titulos.aPagar.valorPago),
                  })
                : t('tiss.acompanhamento.semAPagar')
            }}
          </li>
          <li>
            {{
              p.data.value.titulos.aReceber
                ? t('tiss.acompanhamento.titulos.aReceber', {
                    titulos: p.data.value.titulos.aReceber.titulos,
                    valor: reais(p.data.value.titulos.aReceber.valor),
                    recebidos: p.data.value.titulos.aReceber.recebidos,
                    valorRecebido: reais(p.data.value.titulos.aReceber.valorRecebido),
                  })
                : t('tiss.acompanhamento.semAReceber')
            }}
          </li>
        </ul>
        <p v-if="!p.data.value.titulos.movimento">{{ t('tiss.acompanhamento.semMovimento') }}</p>
        <table v-else class="tabela" data-testid="ac-movimento">
          <caption>
            {{
              t('tiss.acompanhamento.titulos.movimento')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('tiss.acompanhamento.titulos.tipo') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.titulos.lancamentos') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in p.data.value.titulos.movimento" :key="m.tipo">
              <td>{{ m.rotulo }}</td>
              <td>{{ m.lancamentos }}</td>
              <td>{{ reais(m.valor) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <h3>{{ t('tiss.acompanhamento.repasse.titulo') }}</h3>
      <p v-if="!p.data.value.repasse.disponivel" data-testid="ac-repasse-indisponivel">
        {{ p.data.value.repasse.motivo }}
      </p>
      <ul v-else data-testid="ac-repasse">
        <li>
          {{
            t('tiss.acompanhamento.repasse.integrados', {
              n: p.data.value.repasse.itensIntegrados,
              valor: reais(p.data.value.repasse.valorIntegrado),
            })
          }}
        </li>
        <li>
          {{
            t('tiss.acompanhamento.repasse.eventos', {
              n: p.data.value.repasse.eventos,
              valor: reais(p.data.value.repasse.valorEventos),
            })
          }}
        </li>
        <li>{{ t('tiss.acompanhamento.repasse.rpas', { n: p.data.value.repasse.rpas }) }}</li>
      </ul>

      <h3>{{ t('tiss.acompanhamento.gravacoes.titulo') }}</h3>
      <table class="tabela" data-testid="ac-gravacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.acompanhamento.gravacoes.operacao') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.gravacoesSetor') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.gravacoes.peloNovo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in p.data.value.gravacoes" :key="g.operacao" :data-operacao="g.operacao">
            <td>{{ g.rotulo }}</td>
            <td>{{ g.setorNome }}</td>
            <td>{{ g.peloNovo }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('tiss.acompanhamento.uso.titulo') }}</h3>
      <p v-if="!p.data.value.uso.disponivel" data-testid="ac-uso-indisponivel">
        {{ p.data.value.uso.motivo }}
      </p>
      <table v-else class="tabela" data-testid="ac-uso">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.acompanhamento.uso.grupo') }}</th>
            <th scope="col">{{ t('tiss.acompanhamento.uso.usuarios') }}</th>
            <th scope="col">
              {{ t('tiss.acompanhamento.uso.conectados', { desde: p.data.value.uso.desde }) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in p.data.value.uso.grupos" :key="u.grupo">
            <td>{{ u.grupo }}</td>
            <td>{{ contagem(u.usuarios) }}</td>
            <td>{{ contagem(u.conectadosDesde) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('tiss.acompanhamento.conferencia.titulo') }}</h3>
      <p>{{ t('tiss.acompanhamento.conferencia.texto') }}</p>
      <form data-testid="ac-conferencia" @submit.prevent="conferir">
        <table class="tabela">
          <caption>
            {{
              t('tiss.acompanhamento.conferencia.blocos.contas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('tiss.acompanhamento.convenio') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.contasN') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.fechadasConvenio') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in conveniosConf" :key="c" :data-testid="`ac-inf-linha-${c}`">
              <td>{{ c }} — {{ nomeConvenio(c) }}</td>
              <td v-for="campo in ['contas', 'fechadas', 'valor']" :key="campo">
                <input
                  v-if="informado[c]"
                  v-model="informado[c]![campo]"
                  :inputmode="campo === 'valor' ? 'decimal' : 'numeric'"
                  :aria-label="`${t(`tiss.acompanhamento.conferencia.campos.${campo}`)} ${c}`"
                  :data-testid="`ac-inf-${campo}-${c}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="secundario">{{ t('tiss.acompanhamento.conferencia.emBranco') }}</p>
        <div class="filtros">
          <SanteSelecao
            id="ac-acrescentar-convenio"
            v-model="novoConvenio"
            :rotulo="t('tiss.acompanhamento.conferencia.acrescentarConvenio')"
            :opcoes="opcoesAcrescentar"
            busca
            data-testid="ac-acrescentar-convenio"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('tiss.acompanhamento.conferencia.acrescentar')"
            :desabilitado="novoConvenio === ''"
            data-testid="ac-acrescentar"
            @acionar="acrescentarConvenio"
          />
        </div>

        <fieldset
          v-for="b in ['lotes', 'glosas', 'aPagar', 'aReceber', 'repasse'] as const"
          :key="b"
          v-show="
            b === 'lotes' ||
            (b === 'glosas' && p.data.value.glosas.disponivel) ||
            (b === 'aPagar' && p.data.value.titulos.disponivel && p.data.value.titulos.aPagar) ||
            (b === 'aReceber' && p.data.value.titulos.disponivel && p.data.value.titulos.aReceber) ||
            (b === 'repasse' && p.data.value.repasse.disponivel)
          "
          :data-testid="`ac-inf-bloco-${b}`"
        >
          <legend>{{ t(`tiss.acompanhamento.conferencia.blocos.${b}`) }}</legend>
          <span v-for="campo in Object.keys(blocos[b])" :key="campo" class="campo">
            <label :for="`ac-inf-${b}-${campo}`">{{
              t(`tiss.acompanhamento.conferencia.campos.${campo}`)
            }}</label>
            <input
              :id="`ac-inf-${b}-${campo}`"
              v-model="blocos[b][campo]"
              :inputmode="INTEIROS.has(campo) ? 'numeric' : 'decimal'"
              :data-testid="`ac-inf-${b}-${campo}`"
            />
          </span>
        </fieldset>

        <table
          v-if="p.data.value.titulos.disponivel && p.data.value.titulos.movimento"
          class="tabela"
          data-testid="ac-inf-movimento"
        >
          <caption>
            {{
              t('tiss.acompanhamento.conferencia.blocos.movimento')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('tiss.acompanhamento.titulos.tipo') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.titulos.lancamentos') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.valor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in tiposConf" :key="x">
              <td>{{ rotuloTipo(x) }}</td>
              <td v-for="campo in ['lancamentos', 'valor']" :key="campo">
                <input
                  v-if="movimentoInf[x]"
                  v-model="movimentoInf[x]![campo]"
                  :inputmode="campo === 'valor' ? 'decimal' : 'numeric'"
                  :aria-label="`${t(`tiss.acompanhamento.conferencia.campos.${campo}`)} ${rotuloTipo(x)}`"
                  :data-testid="`ac-inf-mov-${campo}-${x || 'vazio'}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="p.data.value.titulos.disponivel && p.data.value.titulos.movimento" class="filtros">
          <span class="campo">
            <label for="ac-novo-tipo">{{ t('tiss.acompanhamento.conferencia.acrescentarTipo') }}</label>
            <input id="ac-novo-tipo" v-model="novoTipo" maxlength="5" data-testid="ac-novo-tipo" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('tiss.acompanhamento.conferencia.acrescentar')"
            data-testid="ac-acrescentar-tipo"
            @acionar="acrescentarTipo"
          />
        </div>

        <SanteAlerta
          v-if="incompletos.length"
          :texto="t('tiss.acompanhamento.conferencia.incompleto', { blocos: incompletos.join('; ') })"
          variante="aviso"
          data-testid="ac-incompleto"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('tiss.acompanhamento.conferencia.limpar')"
          data-testid="ac-limpar"
          @acionar="limpar"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('tiss.acompanhamento.conferencia.conferir')"
          :desabilitado="!algumPreenchido || incompletos.length > 0"
          data-testid="ac-conferir"
        />
      </form>
      <ErroFaturamento v-if="erroConf" :erro="erroConf" />
      <div v-if="resultado" data-testid="ac-resultado">
        <p>{{ t('tiss.acompanhamento.conferencia.comparados', { n: resultado.comparados }) }}</p>
        <SanteAlerta
          v-if="resultado.diferencas.length === 0"
          :texto="t('tiss.acompanhamento.diferencas.vazio')"
          variante="info"
          icone="check"
          data-testid="ac-sem-diferenca"
        />
        <SanteAlerta
          v-else
          :texto="t('tiss.acompanhamento.diferencas.comDiferenca', { n: resultado.diferencas.length })"
          variante="aviso"
          data-testid="ac-com-diferenca"
        />
        <table v-if="resultado.diferencas.length" class="tabela" data-testid="ac-diferencas">
          <thead>
            <tr>
              <th scope="col">{{ t('tiss.acompanhamento.diferencas.onde') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.diferencas.campo') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.diferencas.novo') }}</th>
              <th scope="col">{{ t('tiss.acompanhamento.diferencas.outro') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in resultado.diferencas" :key="`${d.chave}-${d.campo}`" :data-chave="d.chave">
              <td>{{ rotuloChave(d.chave) }}</td>
              <td>{{ rotuloCampo(d.campo) }}</td>
              <td>{{ valorDiferenca(d.novo) }}</td>
              <td>{{ valorDiferenca(d.outro) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
