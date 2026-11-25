<script setup lang="ts">
// Cultura e antibiograma na digitação do resultado (F7, 05-SADT linha 12). Aberta do exame pedido: grava pela rota da
// cultura do exame (o resultado em digitação nasce na primeira gravação). Menos cliques: ao escolher o microrganismo, os
// antimicrobianos do painel (o padrão dele ou o escolhido) entram sozinhos, na ordem do laudo; só se digita a CIM ou o
// halo. A regra da cultura final (crescimento × isolados, conclusão) é conferida na hora pela mesma regra do servidor.
// A interpretação, a cascata e a multirresistência vêm do servidor e aparecem depois de gravar. A cultura final só muda
// por retificação com motivo; a anterior fica guardada inteira no servidor.
import { conferirCultura, RecusaMicrobiologia } from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import {
  type CulturaLida,
  gravarCulturaDoExame,
  lerCadastroMicrobiologia,
  lerCulturaDoExame,
  retificarCultura,
} from '../api-microbiologia.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from './ErroSadt.vue';

const props = defineProps<{ exame: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const podeDigitar = podePermissao('sadt.resultado.digitar');
const podeRetificar = podePermissao('sadt.resultado.retificar');
const veCadastro = podePermissao('sadt.catalogo.ler');

type Metodo = 'cim' | 'disco_difusao' | 'gradiente' | 'automatizado';
interface TesteForm {
  antimicrobiano: number;
  metodo: Metodo;
  cim: string;
  halo: string;
}
interface IsoladoForm {
  sequencia: number;
  microrganismo: number | '';
  painel: number | '';
  contagemUfcMl: string;
  betalactamaseEspectroEstendido: boolean;
  carbapenemase: boolean;
  resistenteMeticilina: boolean;
  resistenteVancomicina: boolean;
  contaminanteProvavel: boolean;
  testes: TesteForm[];
}
const CRESCIMENTOS = [
  'em_andamento',
  'sem_crescimento',
  'com_crescimento',
  'contaminada',
  'flora_normal',
] as const;

const cadastro = useQuery({
  queryKey: ['sadt', 'microbiologia', 'cadastro'],
  queryFn: lerCadastroMicrobiologia,
});
const lida = useQuery({
  queryKey: computed(() => ['sadt', 'microbiologia', 'exame', props.exame]),
  queryFn: () => lerCulturaDoExame(props.exame),
});
const cultura = computed<CulturaLida | null>(() => lida.data.value?.cultura ?? null);
const finalLida = computed(() => ['final', 'retificado'].includes(cultura.value?.situacao ?? ''));

const material = ref<number | ''>('');
const crescimento = ref<(typeof CRESCIMENTOS)[number]>('em_andamento');
const contagemColonias = ref('');
const conclusao = ref('');
const observacao = ref('');
const notifica = ref(false);
const final = ref(false);
const motivo = ref('');
const isolados = ref<IsoladoForm[]>([]);
const novoTeste = ref<Record<number, number | ''>>({});

const txt = (v: number | null) => (v === null ? '' : String(v));
watch(
  cultura,
  (c) => {
    material.value = c?.material ?? '';
    crescimento.value = c?.crescimento ?? 'em_andamento';
    contagemColonias.value = c?.contagemColonias ?? '';
    conclusao.value = c?.conclusao ?? '';
    observacao.value = c?.observacao ?? '';
    notifica.value = c?.notificaControleInfeccao ?? false;
    final.value = ['final', 'retificado'].includes(c?.situacao ?? '');
    motivo.value = '';
    isolados.value = (c?.isolados ?? []).map((i) => ({
      sequencia: i.sequencia,
      microrganismo: i.microrganismo,
      painel: '',
      contagemUfcMl: txt(i.contagemUfcMl),
      betalactamaseEspectroEstendido: i.betalactamaseEspectroEstendido,
      carbapenemase: i.carbapenemase,
      resistenteMeticilina: i.resistenteMeticilina,
      resistenteVancomicina: i.resistenteVancomicina,
      contaminanteProvavel: i.contaminanteProvavel,
      testes: i.testes.map((x) => ({
        antimicrobiano: x.antimicrobiano,
        metodo: (x.metodo ?? 'cim') as Metodo,
        cim: txt(x.cim),
        halo: txt(x.halo),
      })),
    }));
  },
  { immediate: true },
);

const nomeAm = (id: number) =>
  cadastro.data.value?.antimicrobianos.find((a) => a.id === id)?.nome ?? `#${id}`;
const opcoesMaterial = computed(() => [
  { valor: '' as number | '', rotulo: t('sadt.microbiologia.cultura.escolha') },
  ...(cadastro.data.value?.materiais ?? []).map((m) => ({ valor: m.id as number | '', rotulo: m.nome })),
]);
const opcoesCrescimento = computed(() =>
  CRESCIMENTOS.map((c) => ({ valor: c, rotulo: t(`sadt.microbiologia.cultura.crescimentos.${c}`) })),
);
const opcoesGerme = computed(() => [
  { valor: '' as number | '', rotulo: t('sadt.microbiologia.cultura.escolha') },
  ...(cadastro.data.value?.microrganismos ?? []).map((m) => ({ valor: m.id as number | '', rotulo: m.nome })),
]);
const opcoesPainel = computed(() => [
  { valor: '' as number | '', rotulo: t('sadt.microbiologia.cultura.painelPadrao') },
  ...(cadastro.data.value?.paineis ?? []).map((p) => ({
    valor: p.id as number | '',
    rotulo: `${p.nome} · ${p.norma}`,
  })),
]);
const opcoesMetodo = computed(() =>
  (['cim', 'disco_difusao', 'gradiente', 'automatizado'] as const).map((m) => ({
    valor: m,
    rotulo: t(`sadt.microbiologia.cultura.metodos.${m}`),
  })),
);
const opcoesAm = (i: IsoladoForm) => [
  { valor: '' as number | '', rotulo: t('sadt.microbiologia.cultura.escolha') },
  ...(cadastro.data.value?.antimicrobianos ?? [])
    .filter((a) => !i.testes.some((x) => x.antimicrobiano === a.id))
    .map((a) => ({ valor: a.id as number | '', rotulo: a.nome })),
];

/** O painel que vale para o isolado: o escolhido ou o padrão do microrganismo. */
function painelDo(i: IsoladoForm) {
  const c = cadastro.data.value;
  const id = i.painel || c?.microrganismos.find((m) => m.id === i.microrganismo)?.painel || null;
  return id ? (c?.paineis.find((p) => p.id === id) ?? null) : null;
}
/** Os antimicrobianos do painel entram sozinhos (os já digitados ficam). */
function carregarPainel(i: IsoladoForm): void {
  const p = painelDo(i);
  if (!p) return;
  const metodo: Metodo = p.metodo === 'disco_difusao' ? 'disco_difusao' : 'cim';
  for (const it of [...p.itens].sort((a, b) => a.sequencia - b.sequencia))
    if (!i.testes.some((x) => x.antimicrobiano === it.antimicrobiano))
      i.testes.push({ antimicrobiano: it.antimicrobiano, metodo, cim: '', halo: '' });
}
function escolherGerme(i: IsoladoForm, v: number | '' | null): void {
  i.microrganismo = v ?? '';
  if (i.microrganismo) carregarPainel(i);
}
function escolherPainel(i: IsoladoForm, v: number | '' | null): void {
  i.painel = v ?? '';
  carregarPainel(i);
}
function incluirIsolado(): void {
  const seq = Math.max(0, ...isolados.value.map((i) => i.sequencia)) + 1;
  isolados.value.push({
    sequencia: seq,
    microrganismo: '',
    painel: '',
    contagemUfcMl: '',
    betalactamaseEspectroEstendido: false,
    carbapenemase: false,
    resistenteMeticilina: false,
    resistenteVancomicina: false,
    contaminanteProvavel: false,
    testes: [],
  });
  if (crescimento.value === 'em_andamento' || crescimento.value === 'sem_crescimento')
    crescimento.value = 'com_crescimento';
}
function incluirTeste(i: IsoladoForm, v: number | '' | null): void {
  if (v) i.testes.push({ antimicrobiano: v, metodo: 'cim', cim: '', halo: '' });
  novoTeste.value[i.sequencia] = '';
}

const numero = (v: string): number | null => {
  const x = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(x) ? x : null;
};
/** A recusa da regra da cultura final, conferida na hora (a mesma do servidor). */
const recusaNaHora = computed<string | null>(() => {
  if (!material.value) return null;
  try {
    conferirCultura({
      crescimento: crescimento.value,
      isolados: isolados.value.length,
      final: final.value,
      conclusao: conclusao.value.trim() || null,
      sequencias: isolados.value.map((i) => i.sequencia),
    });
    return isolados.value.some((i) => !i.microrganismo)
      ? t('sadt.microbiologia.cultura.microrganismo') + ': ' + t('sadt.microbiologia.cultura.escolha')
      : null;
  } catch (e) {
    return e instanceof RecusaMicrobiologia ? e.message : String(e);
  }
});
const retificando = computed(() => finalLida.value);
const podeGravar = computed(() =>
  retificando.value
    ? podeRetificar && motivo.value.trim().length >= 5 && lida.data.value?.resultado != null
    : podeDigitar,
);

/** Interpretação lida do servidor para o teste já gravado. */
const lidoDo = (seq: number, am: number) =>
  cultura.value?.isolados.find((i) => i.sequencia === seq)?.testes.find((x) => x.antimicrobiano === am) ??
  null;
const isoladoLido = (seq: number) => cultura.value?.isolados.find((i) => i.sequencia === seq) ?? null;

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  if (!material.value || recusaNaHora.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const corpo = {
      material: material.value,
      crescimento: crescimento.value,
      contagemColonias: contagemColonias.value.trim() || null,
      conclusao: conclusao.value.trim() || null,
      observacao: observacao.value.trim() || null,
      notificaControleInfeccao: notifica.value,
      final: final.value,
      motivoRetificacao: retificando.value ? motivo.value.trim() : null,
      versao: cultura.value?.versao ?? null,
      isolados: isolados.value.map((i) => ({
        sequencia: i.sequencia,
        microrganismo: i.microrganismo,
        painel: i.painel || null,
        contagemUfcMl: numero(i.contagemUfcMl),
        betalactamaseEspectroEstendido: i.betalactamaseEspectroEstendido,
        carbapenemase: i.carbapenemase,
        resistenteMeticilina: i.resistenteMeticilina,
        resistenteVancomicina: i.resistenteVancomicina,
        contaminanteProvavel: i.contaminanteProvavel,
        testes: i.testes.map((x) => ({
          antimicrobiano: x.antimicrobiano,
          metodo: x.metodo,
          cim: x.metodo === 'disco_difusao' ? null : numero(x.cim),
          halo: x.metodo === 'disco_difusao' ? numero(x.halo) : null,
        })),
      })),
    };
    const r = retificando.value
      ? await retificarCultura(lida.data.value!.resultado!, corpo, novaChave('cultura-retificar'))
      : await gravarCulturaDoExame(props.exame, corpo, novaChave('cultura'));
    mensagem.value = [
      t('sadt.microbiologia.cultura.gravada', {
        isolados: r.isolados,
        testes: r.testes,
        multi: r.multirresistentes,
      }),
      r.notificados ? t('sadt.microbiologia.cultura.notificados', { n: r.notificados }) : '',
    ]
      .filter(Boolean)
      .join(' ');
    await cliente.invalidateQueries({ queryKey: ['sadt', 'microbiologia', 'exame', props.exame] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="cultura-titulo" data-testid="cultura-painel">
    <h3 id="cultura-titulo">{{ t('sadt.microbiologia.cultura.titulo') }}</h3>
    <p class="secundario">{{ t('sadt.microbiologia.cultura.texto') }}</p>
    <p v-if="veCadastro">
      <RouterLink to="/sadt/microbiologia/cadastro" data-testid="cultura-link-cadastro">{{
        t('sadt.microbiologia.cultura.cadastro')
      }}</RouterLink>
    </p>
    <ErroSadt
      v-if="cadastro.isError.value || lida.isError.value"
      :erro="cadastro.error.value ?? lida.error.value"
    />
    <p v-else-if="!cadastro.data.value || !lida.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!podeDigitar" variante="aviso" :texto="t('sadt.microbiologia.cultura.semDigitar')" />
      <p v-if="cultura" data-testid="cultura-situacao">
        {{
          t('sadt.microbiologia.cultura.situacao', {
            situacao: t(`sadt.microbiologia.cultura.situacoes.${cultura.situacao}`),
          })
        }}
      </p>
      <div class="filtros">
        <SanteSelecao
          v-model="material"
          :rotulo="t('sadt.microbiologia.cultura.material')"
          :opcoes="opcoesMaterial"
          obrigatorio
          data-testid="cultura-material"
        />
        <SanteSelecao
          v-model="crescimento"
          :rotulo="t('sadt.microbiologia.cultura.crescimento')"
          :opcoes="opcoesCrescimento"
          data-testid="cultura-crescimento"
        />
        <span class="campo">
          <label for="cultura-colonias">{{ t('sadt.microbiologia.cultura.contagemColonias') }}</label>
          <input id="cultura-colonias" v-model="contagemColonias" maxlength="50" />
        </span>
      </div>

      <fieldset
        v-for="i in isolados"
        :key="i.sequencia"
        class="painel"
        :data-testid="`cultura-isolado-${i.sequencia}`"
      >
        <legend>{{ t('sadt.microbiologia.cultura.isolado', { n: i.sequencia }) }}</legend>
        <p v-if="isoladoLido(i.sequencia)?.multirresistente" :data-testid="`cultura-mr-${i.sequencia}`">
          <strong>{{ t('sadt.microbiologia.cultura.multirresistente') }}</strong>
          <template v-if="isoladoLido(i.sequencia)?.notificadoControleInfeccao">
            · {{ t('sadt.microbiologia.cultura.notificado') }}</template
          >
        </p>
        <div class="filtros">
          <SanteSelecao
            :model-value="i.microrganismo"
            :rotulo="t('sadt.microbiologia.cultura.microrganismo')"
            :opcoes="opcoesGerme"
            obrigatorio
            :data-testid="`cultura-germe-${i.sequencia}`"
            @update:model-value="(v: number | '' | null) => escolherGerme(i, v)"
          />
          <SanteSelecao
            :model-value="i.painel"
            :rotulo="t('sadt.microbiologia.cultura.painel')"
            :opcoes="opcoesPainel"
            :data-testid="`cultura-painel-${i.sequencia}`"
            @update:model-value="(v: number | '' | null) => escolherPainel(i, v)"
          />
          <span class="campo">
            <label :for="`cultura-ufc-${i.sequencia}`">{{
              t('sadt.microbiologia.cultura.contagemUfc')
            }}</label>
            <input :id="`cultura-ufc-${i.sequencia}`" v-model="i.contagemUfcMl" inputmode="decimal" />
          </span>
        </div>
        <fieldset class="filtros">
          <legend>{{ t('sadt.microbiologia.cultura.marcadores') }}</legend>
          <label
            ><input v-model="i.betalactamaseEspectroEstendido" type="checkbox" />
            {{ t('sadt.microbiologia.cultura.esbl') }}</label
          >
          <label
            ><input v-model="i.carbapenemase" type="checkbox" />
            {{ t('sadt.microbiologia.cultura.carbapenemase') }}</label
          >
          <label
            ><input v-model="i.resistenteMeticilina" type="checkbox" />
            {{ t('sadt.microbiologia.cultura.meticilina') }}</label
          >
          <label
            ><input v-model="i.resistenteVancomicina" type="checkbox" />
            {{ t('sadt.microbiologia.cultura.vancomicina') }}</label
          >
          <label
            ><input v-model="i.contaminanteProvavel" type="checkbox" />
            {{ t('sadt.microbiologia.cultura.contaminante') }}</label
          >
        </fieldset>
        <p v-if="!i.testes.length" class="secundario">{{ t('sadt.microbiologia.cultura.doPainel') }}</p>
        <table v-else class="tabela" :data-testid="`cultura-testes-${i.sequencia}`">
          <caption>
            {{
              t('sadt.microbiologia.cultura.isolado', { n: i.sequencia })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.microbiologia.cultura.antimicrobiano') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cultura.metodo') }}</th>
              <th scope="col">
                {{ t('sadt.microbiologia.cultura.cim') }} / {{ t('sadt.microbiologia.cultura.halo') }}
              </th>
              <th scope="col">{{ t('sadt.microbiologia.cultura.interpretacao') }}</th>
              <th scope="col">{{ t('sadt.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(x, k) in i.testes"
              :key="x.antimicrobiano"
              :data-testid="`cultura-teste-${i.sequencia}-${x.antimicrobiano}`"
            >
              <td>{{ nomeAm(x.antimicrobiano) }}</td>
              <td>
                <SanteSelecao
                  v-model="x.metodo"
                  :rotulo="`${t('sadt.microbiologia.cultura.metodo')}: ${nomeAm(x.antimicrobiano)}`"
                  ocultar-rotulo
                  :opcoes="opcoesMetodo"
                />
              </td>
              <td>
                <input
                  v-if="x.metodo === 'disco_difusao'"
                  v-model="x.halo"
                  inputmode="decimal"
                  :aria-label="`${t('sadt.microbiologia.cultura.halo')}: ${nomeAm(x.antimicrobiano)}`"
                  :data-testid="`cultura-medida-${i.sequencia}-${x.antimicrobiano}`"
                />
                <input
                  v-else
                  v-model="x.cim"
                  inputmode="decimal"
                  :aria-label="`${t('sadt.microbiologia.cultura.cim')}: ${nomeAm(x.antimicrobiano)}`"
                  :data-testid="`cultura-medida-${i.sequencia}-${x.antimicrobiano}`"
                />
              </td>
              <td :data-testid="`cultura-interpretacao-${i.sequencia}-${x.antimicrobiano}`">
                <template v-if="lidoDo(i.sequencia, x.antimicrobiano)">
                  {{
                    t(
                      `sadt.microbiologia.cultura.interpretacoes.${lidoDo(i.sequencia, x.antimicrobiano)!.interpretacao}`,
                    )
                  }}
                  ·
                  {{
                    lidoDo(i.sequencia, x.antimicrobiano)!.exibeNoLaudo
                      ? t('sadt.microbiologia.cultura.noLaudo')
                      : t('sadt.microbiologia.cultura.oculto')
                  }}
                </template>
                <template v-else>—</template>
              </td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('sadt.microbiologia.cultura.retirarTeste')"
                  @acionar="i.testes.splice(k, 1)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <SanteSelecao
          :model-value="novoTeste[i.sequencia] ?? ''"
          :rotulo="t('sadt.microbiologia.cultura.incluirAntimicrobiano')"
          :opcoes="opcoesAm(i)"
          :data-testid="`cultura-incluir-am-${i.sequencia}`"
          @update:model-value="(v: number | '' | null) => incluirTeste(i, v)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('sadt.microbiologia.cultura.retirarIsolado')"
          :data-testid="`cultura-retirar-isolado-${i.sequencia}`"
          @acionar="isolados = isolados.filter((y) => y.sequencia !== i.sequencia)"
        />
      </fieldset>
      <SanteBotao
        variante="secundario"
        :rotulo="t('sadt.microbiologia.cultura.incluirIsolado')"
        data-testid="cultura-incluir-isolado"
        @acionar="incluirIsolado"
      />

      <span class="campo">
        <label for="cultura-conclusao">{{ t('sadt.microbiologia.cultura.conclusao') }}</label>
        <textarea id="cultura-conclusao" v-model="conclusao" rows="2" maxlength="4000" />
      </span>
      <span class="campo">
        <label for="cultura-observacao">{{ t('sadt.microbiologia.cultura.observacao') }}</label>
        <textarea id="cultura-observacao" v-model="observacao" rows="2" maxlength="4000" />
      </span>
      <label
        ><input v-model="notifica" type="checkbox" data-testid="cultura-notifica" />
        {{ t('sadt.microbiologia.cultura.notifica') }}</label
      >
      <label
        ><input v-model="final" type="checkbox" :disabled="finalLida" data-testid="cultura-final" />
        {{ t('sadt.microbiologia.cultura.final') }}</label
      >
      <span v-if="retificando" class="campo">
        <label for="cultura-motivo">{{ t('sadt.microbiologia.cultura.motivo') }}</label>
        <input id="cultura-motivo" v-model="motivo" maxlength="500" data-testid="cultura-motivo" />
      </span>
      <p v-if="recusaNaHora" role="alert" data-testid="cultura-recusa">{{ recusaNaHora }}</p>
      <SanteBotao
        v-if="podeDigitar || (retificando && podeRetificar)"
        :rotulo="
          retificando ? t('sadt.microbiologia.cultura.retificar') : t('sadt.microbiologia.cultura.gravar')
        "
        :desabilitado="ocupado || !material || !!recusaNaHora || !podeGravar"
        data-testid="cultura-gravar"
        @acionar="gravar"
      />
      <p v-if="mensagem" role="status" data-testid="cultura-mensagem">{{ mensagem }}</p>
      <ErroSadt v-if="erro" :erro="erro" />
      <section v-if="cultura?.laudo" aria-labelledby="cultura-laudo">
        <h4 id="cultura-laudo">{{ t('sadt.microbiologia.cultura.laudo') }}</h4>
        <pre data-testid="cultura-laudo">{{ cultura.laudo }}</pre>
      </section>
    </template>
  </section>
</template>
