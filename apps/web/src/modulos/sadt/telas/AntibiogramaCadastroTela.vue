<script setup lang="ts">
// Painéis de antibiograma e pontos de corte (F7, 05-SADT linha 12): `/sadt/microbiologia/cadastro`. O painel define os
// antimicrobianos testados, a ordem do laudo (subir e descer), a liberação em cascata e o marcador de
// multirresistência, e pode virar o padrão do microrganismo; o ponto de corte converte a CIM ou o halo na interpretação,
// por norma (BrCAST, EUCAST, CLSI) e versão. As regras (limites coerentes com o método, cascata com primeira linha,
// versão nova que encerra a anterior na véspera, ponto usado que só encerra) são do domínio e o servidor confere; a
// tela confere o que pode na hora. Nada se apaga.
import { conferirPainel, conferirPontoCorte, RecusaMicrobiologia } from '@sgh/dominio-sadt';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import {
  criarPontoCorte,
  encerrarPontoCorte,
  gravarPainelAntibiograma,
  lerCadastroDosPaineis,
  listarPontosCorte,
} from '../api-microbiologia.js';
import { hojeLocal } from '../usar-sadt.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeEditar = podePermissao('sadt.catalogo.editar');
const NORMAS = ['BrCAST', 'EUCAST', 'CLSI'] as const;
const cadastro = useQuery({
  queryKey: ['sadt', 'microbiologia', 'cadastro', 'paineis'],
  queryFn: lerCadastroDosPaineis,
});
const recusaDe = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof RecusaMicrobiologia ? e.message : String(e);
  }
};
const numero = (v: string): number | null => {
  const x = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(x) ? x : null;
};
const escolha = computed(() => ({
  valor: '' as number | '',
  rotulo: t('sadt.microbiologia.cultura.escolha'),
}));
const qualquer = computed(() => ({
  valor: '' as number | '',
  rotulo: t('sadt.microbiologia.cadastro.qualquer'),
}));
const germes = computed(() =>
  (cadastro.data.value?.microrganismos ?? []).map((m) => ({ valor: m.id as number | '', rotulo: m.nome })),
);
const materiais = computed(() =>
  (cadastro.data.value?.materiais ?? []).map((m) => ({ valor: m.id as number | '', rotulo: m.nome })),
);
const nomeAm = (id: number) =>
  cadastro.data.value?.antimicrobianos.find((a) => a.id === id)?.nome ?? `#${id}`;
const opcoesNorma = NORMAS.map((x) => ({ valor: x, rotulo: x }));

// ── Painel ───────────────────────────────────────────────────────────────────────────────────────────────
interface ItemForm {
  antimicrobiano: number;
  exibeNoLaudo: boolean;
  liberacaoRestrita: boolean;
  indicaMultirresistencia: boolean;
}
const painelId = ref<number | null>(null);
const painelVersao = ref<number | null>(null);
const editandoPainel = ref(false);
const pCodigo = ref('');
const pDescricao = ref('');
const pGerme = ref<number | ''>('');
const pMaterial = ref<number | ''>('');
const pMetodo = ref<'disco_difusao' | 'concentracao_inibitoria' | 'gradiente' | 'automatizado'>(
  'disco_difusao',
);
const pNorma = ref<string>('BrCAST');
const pPadrao = ref(false);
const pAtivo = ref(true);
const pItens = ref<ItemForm[]>([]);
const pNovoAm = ref<number | ''>('');
const opcoesMetodoPainel = computed(() =>
  (['disco_difusao', 'concentracao_inibitoria', 'gradiente', 'automatizado'] as const).map((m) => ({
    valor: m,
    rotulo: t(`sadt.microbiologia.cadastro.metodos.${m}`),
  })),
);
const opcoesAmPainel = computed(() => [
  escolha.value,
  ...(cadastro.data.value?.antimicrobianos ?? [])
    .filter((a) => !pItens.value.some((i) => i.antimicrobiano === a.id))
    .map((a) => ({ valor: a.id as number | '', rotulo: a.nome })),
]);
function novoPainel(): void {
  painelId.value = null;
  painelVersao.value = null;
  pCodigo.value = '';
  pDescricao.value = '';
  pGerme.value = '';
  pMaterial.value = '';
  pMetodo.value = 'disco_difusao';
  pNorma.value = 'BrCAST';
  pPadrao.value = false;
  pAtivo.value = true;
  pItens.value = [];
  editandoPainel.value = true;
}
function editarPainel(id: number): void {
  const p = cadastro.data.value?.paineis.find((x) => x.id === id);
  if (!p) return;
  painelId.value = p.id;
  painelVersao.value = p.versao;
  pCodigo.value = p.codigo;
  pDescricao.value = p.nome;
  pGerme.value = p.microrganismo ?? '';
  pMaterial.value = p.material ?? '';
  pMetodo.value = p.metodo as typeof pMetodo.value;
  pNorma.value = p.norma;
  pPadrao.value = cadastro.data.value?.microrganismos.find((m) => m.id === p.microrganismo)?.painel === p.id;
  pAtivo.value = p.ativo;
  pItens.value = [...p.itens]
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((i) => ({
      antimicrobiano: i.antimicrobiano,
      exibeNoLaudo: i.exibeNoLaudo,
      liberacaoRestrita: i.liberacaoRestrita,
      indicaMultirresistencia: i.indicaMultirresistencia,
    }));
  editandoPainel.value = true;
}
function incluirItem(v: number | '' | null): void {
  if (v)
    pItens.value.push({
      antimicrobiano: v,
      exibeNoLaudo: true,
      liberacaoRestrita: false,
      indicaMultirresistencia: false,
    });
  pNovoAm.value = '';
}
function mover(k: number, d: -1 | 1): void {
  const j = k + d;
  if (j < 0 || j >= pItens.value.length) return;
  const [x] = pItens.value.splice(k, 1);
  pItens.value.splice(j, 0, x!);
}
const recusaPainel = computed(() =>
  pItens.value.length ? recusaDe(() => conferirPainel(pItens.value)) : null,
);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravarPainel(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await gravarPainelAntibiograma(
      painelId.value,
      {
        codigo: pCodigo.value.trim(),
        descricao: pDescricao.value.trim(),
        microrganismo: pGerme.value || null,
        material: pMaterial.value || null,
        metodo: pMetodo.value,
        norma: pNorma.value,
        ativo: pAtivo.value,
        padraoDoMicrorganismo: pAtivo.value && pPadrao.value && !!pGerme.value,
        versao: painelVersao.value,
        itens: pItens.value,
      },
      novaChave('painel-antibiograma'),
    );
    mensagem.value = t('sadt.microbiologia.cadastro.painelGravado');
    editandoPainel.value = false;
    await cliente.invalidateQueries({ queryKey: ['sadt', 'microbiologia'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Pontos de corte ──────────────────────────────────────────────────────────────────────────────────────
const filtroGerme = ref<number | ''>('');
const pontos = useQuery({
  queryKey: computed(() => ['sadt', 'microbiologia', 'pontos', filtroGerme.value]),
  queryFn: () => listarPontosCorte(filtroGerme.value || null),
});
const novo = ref({
  microrganismo: '' as number | '',
  antimicrobiano: '' as number | '',
  material: '' as number | '',
  metodo: 'concentracao_inibitoria' as 'concentracao_inibitoria' | 'disco_difusao',
  norma: 'BrCAST',
  versaoNorma: '',
  sensivelAte: '',
  resistenteAcima: '',
  haloSensivelMinimo: '',
  haloResistenteMaximo: '',
  vigenciaInicio: hojeLocal(),
});
const opcoesMetodoPonto = computed(() =>
  (['concentracao_inibitoria', 'disco_difusao'] as const).map((m) => ({
    valor: m,
    rotulo: t(`sadt.microbiologia.cadastro.metodos.${m}`),
  })),
);
const opcoesAm = computed(() => [
  escolha.value,
  ...(cadastro.data.value?.antimicrobianos ?? []).map((a) => ({
    valor: a.id as number | '',
    rotulo: a.nome,
  })),
]);
const corpoPonto = computed(() => {
  const v = novo.value;
  const cim = v.metodo === 'concentracao_inibitoria';
  return {
    microrganismo: v.microrganismo || 0,
    antimicrobiano: v.antimicrobiano || 0,
    material: v.material || null,
    metodo: v.metodo,
    norma: v.norma,
    versaoNorma: v.versaoNorma.trim(),
    sensivelAte: cim ? numero(v.sensivelAte) : null,
    resistenteAcima: cim ? numero(v.resistenteAcima) : null,
    haloSensivelMinimo: cim ? null : numero(v.haloSensivelMinimo),
    haloResistenteMaximo: cim ? null : numero(v.haloResistenteMaximo),
    vigenciaInicio: v.vigenciaInicio,
    vigenciaFim: null,
  };
});
const recusaPonto = computed(() =>
  !novo.value.microrganismo || !novo.value.antimicrobiano
    ? t('sadt.microbiologia.cadastro.faltaPar')
    : recusaDe(() => conferirPontoCorte(corpoPonto.value)),
);
async function gravarPonto(): Promise<void> {
  if (recusaPonto.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await criarPontoCorte(corpoPonto.value, novaChave('ponto-corte'));
    mensagem.value = r.encerrados.length
      ? t('sadt.microbiologia.cadastro.pontoEncerrou', { n: r.encerrados.length })
      : t('sadt.microbiologia.cadastro.pontoGravado');
    await cliente.invalidateQueries({ queryKey: ['sadt', 'microbiologia', 'pontos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const fimDe = ref<Record<number, string>>({});
async function encerrar(id: number, versao: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await encerrarPontoCorte(
      id,
      { versao, vigenciaFim: fimDe.value[id] || hojeLocal() },
      novaChave('ponto-encerrar'),
    );
    mensagem.value = t('sadt.microbiologia.cadastro.encerrado');
    await cliente.invalidateQueries({ queryKey: ['sadt', 'microbiologia', 'pontos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const limites = (p: {
  metodo: string;
  sensivelAte: number | null;
  resistenteAcima: number | null;
  haloSensivelMinimo: number | null;
  haloResistenteMaximo: number | null;
}) =>
  p.metodo === 'disco_difusao'
    ? `S ≥ ${p.haloSensivelMinimo ?? '—'} mm · R ≤ ${p.haloResistenteMaximo ?? '—'} mm`
    : `S ≤ ${p.sensivelAte ?? '—'} · R > ${p.resistenteAcima ?? '—'} mg/L`;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="antibiograma-titulo" data-testid="tela-antibiograma-cadastro">
    <h1 id="antibiograma-titulo">{{ t('sadt.microbiologia.cadastro.titulo') }}</h1>
    <p>{{ t('sadt.microbiologia.cadastro.texto') }}</p>
    <SanteAlerta v-if="!podeEditar" variante="aviso" :texto="t('sadt.microbiologia.cadastro.semEditar')" />
    <ErroSadt v-if="cadastro.isError.value" :erro="cadastro.error.value" />
    <p v-else-if="!cadastro.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="antibiograma-paineis">
        <h2 id="antibiograma-paineis">{{ t('sadt.microbiologia.cadastro.paineis') }}</h2>
        <table class="tabela" data-testid="antibiograma-paineis">
          <caption>
            {{
              t('sadt.microbiologia.cadastro.paineis')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.codigo') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.descricao') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.norma') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.itens') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.situacao') }}</th>
              <th scope="col">{{ t('sadt.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in cadastro.data.value.paineis"
              :key="p.id"
              :data-testid="`antibiograma-painel-${p.id}`"
            >
              <td>{{ p.codigo }}</td>
              <td>{{ p.nome }}</td>
              <td>{{ p.norma }}</td>
              <td>{{ p.itens.length }}</td>
              <td :data-testid="`antibiograma-situacao-${p.id}`">
                {{ t(p.ativo ? 'sadt.microbiologia.cadastro.ativo' : 'sadt.microbiologia.cadastro.inativo') }}
              </td>
              <td>
                <SanteBotao
                  v-if="podeEditar"
                  variante="secundario"
                  :rotulo="t('sadt.microbiologia.cadastro.editar')"
                  :data-testid="`antibiograma-editar-${p.id}`"
                  @acionar="editarPainel(p.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <SanteBotao
          v-if="podeEditar"
          variante="secundario"
          :rotulo="t('sadt.microbiologia.cadastro.novoPainel')"
          data-testid="antibiograma-novo-painel"
          @acionar="novoPainel"
        />
        <form v-if="editandoPainel" class="painel" data-testid="antibiograma-form-painel" @submit.prevent>
          <div class="filtros">
            <span class="campo">
              <label for="painel-codigo">{{ t('sadt.microbiologia.cadastro.codigo') }}</label>
              <input
                id="painel-codigo"
                v-model="pCodigo"
                maxlength="30"
                required
                data-testid="painel-codigo"
              />
            </span>
            <span class="campo">
              <label for="painel-descricao">{{ t('sadt.microbiologia.cadastro.descricao') }}</label>
              <input
                id="painel-descricao"
                v-model="pDescricao"
                maxlength="150"
                required
                data-testid="painel-descricao"
              />
            </span>
            <SanteSelecao
              v-model="pGerme"
              :rotulo="t('sadt.microbiologia.cadastro.microrganismo')"
              :opcoes="[qualquer, ...germes]"
              data-testid="painel-germe"
            />
            <SanteSelecao
              v-model="pMaterial"
              :rotulo="t('sadt.microbiologia.cadastro.material')"
              :opcoes="[qualquer, ...materiais]"
            />
            <SanteSelecao
              v-model="pMetodo"
              :rotulo="t('sadt.microbiologia.cadastro.metodo')"
              :opcoes="opcoesMetodoPainel"
            />
            <SanteSelecao
              v-model="pNorma"
              :rotulo="t('sadt.microbiologia.cadastro.norma')"
              :opcoes="opcoesNorma"
            />
          </div>
          <label
            ><input v-model="pAtivo" type="checkbox" data-testid="painel-ativo" />
            {{ t('sadt.microbiologia.cadastro.painelAtivo') }}</label
          >
          <SanteAlerta
            v-if="!pAtivo"
            variante="aviso"
            :texto="t('sadt.microbiologia.cadastro.avisoInativo')"
            data-testid="painel-inativo-aviso"
          />
          <label v-if="pGerme && pAtivo"
            ><input v-model="pPadrao" type="checkbox" data-testid="painel-padrao" />
            {{ t('sadt.microbiologia.cadastro.padrao') }}</label
          >
          <table v-if="pItens.length" class="tabela" data-testid="painel-itens">
            <caption>
              {{
                t('sadt.microbiologia.cadastro.itens')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{{ t('sadt.microbiologia.cadastro.antimicrobiano') }}</th>
                <th scope="col">{{ t('sadt.microbiologia.cadastro.exibe') }}</th>
                <th scope="col">{{ t('sadt.microbiologia.cadastro.restrita') }}</th>
                <th scope="col">{{ t('sadt.microbiologia.cadastro.indicaMr') }}</th>
                <th scope="col">{{ t('sadt.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(i, k) in pItens"
                :key="i.antimicrobiano"
                :data-testid="`painel-item-${i.antimicrobiano}`"
              >
                <td>{{ k + 1 }}</td>
                <td>{{ nomeAm(i.antimicrobiano) }}</td>
                <td>
                  <input
                    v-model="i.exibeNoLaudo"
                    type="checkbox"
                    :aria-label="`${t('sadt.microbiologia.cadastro.exibe')}: ${nomeAm(i.antimicrobiano)}`"
                  />
                </td>
                <td>
                  <input
                    v-model="i.liberacaoRestrita"
                    type="checkbox"
                    :aria-label="`${t('sadt.microbiologia.cadastro.restrita')}: ${nomeAm(i.antimicrobiano)}`"
                    :data-testid="`painel-restrita-${i.antimicrobiano}`"
                  />
                </td>
                <td>
                  <input
                    v-model="i.indicaMultirresistencia"
                    type="checkbox"
                    :aria-label="`${t('sadt.microbiologia.cadastro.indicaMr')}: ${nomeAm(i.antimicrobiano)}`"
                  />
                </td>
                <td>
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('sadt.microbiologia.cadastro.subir')"
                    @acionar="mover(k, -1)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('sadt.microbiologia.cadastro.descer')"
                    :data-testid="`painel-descer-${i.antimicrobiano}`"
                    @acionar="mover(k, 1)"
                  />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('sadt.microbiologia.cadastro.retirar')"
                    @acionar="pItens.splice(k, 1)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <SanteSelecao
            :model-value="pNovoAm"
            :rotulo="t('sadt.microbiologia.cadastro.incluirItem')"
            :opcoes="opcoesAmPainel"
            data-testid="painel-incluir-am"
            @update:model-value="incluirItem"
          />
          <p v-if="recusaPainel" role="alert" data-testid="painel-recusa">{{ recusaPainel }}</p>
          <SanteBotao
            :rotulo="t('sadt.microbiologia.cadastro.gravarPainel')"
            :desabilitado="
              ocupado || !pItens.length || !!recusaPainel || !pCodigo.trim() || pDescricao.trim().length < 3
            "
            data-testid="painel-gravar"
            @acionar="gravarPainel"
          />
        </form>
      </section>

      <section class="painel" aria-labelledby="antibiograma-pontos">
        <h2 id="antibiograma-pontos">{{ t('sadt.microbiologia.cadastro.pontos') }}</h2>
        <SanteSelecao
          v-model="filtroGerme"
          :rotulo="t('sadt.microbiologia.cadastro.filtroGerme')"
          :opcoes="[qualquer, ...germes]"
          data-testid="pontos-filtro-germe"
        />
        <ErroSadt v-if="pontos.isError.value" :erro="pontos.error.value" />
        <p v-else-if="!pontos.data.value" role="status">{{ t('sadt.carregando') }}</p>
        <p v-else-if="!pontos.data.value.length">{{ t('sadt.microbiologia.cadastro.nenhum') }}</p>
        <table v-else class="tabela" data-testid="pontos-tabela">
          <caption>
            {{
              t('sadt.microbiologia.cadastro.pontos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.microrganismo') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.antimicrobiano') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.norma') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.metodo') }}</th>
              <th scope="col">{{ t('sadt.microbiologia.cadastro.vigenciaInicio') }}</th>
              <th scope="col">{{ t('sadt.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pontos.data.value" :key="p.id" :data-testid="`ponto-${p.id}`">
              <td>{{ p.microrganismoNome }}</td>
              <td>{{ p.antimicrobianoNome }}</td>
              <td>{{ p.norma }} {{ p.versaoNorma }}</td>
              <td>{{ limites(p) }}</td>
              <td>
                {{
                  t('sadt.microbiologia.cadastro.vigencia', {
                    de: p.vigenciaInicio,
                    ate: p.vigenciaFim ?? '…',
                  })
                }}
                <template v-if="p.emUso"> · {{ t('sadt.microbiologia.cadastro.emUso') }}</template>
              </td>
              <td>
                <span v-if="podeEditar && !p.vigenciaFim" class="campo">
                  <label :for="`ponto-fim-${p.id}`">{{ t('sadt.microbiologia.cadastro.encerrarEm') }}</label>
                  <input :id="`ponto-fim-${p.id}`" v-model="fimDe[p.id]" type="date" />
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('sadt.microbiologia.cadastro.encerrar')"
                    :desabilitado="ocupado"
                    :data-testid="`ponto-encerrar-${p.id}`"
                    @acionar="encerrar(p.id, p.versao)"
                  />
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <form v-if="podeEditar" class="painel" data-testid="ponto-form" @submit.prevent>
          <h3>{{ t('sadt.microbiologia.cadastro.novoPonto') }}</h3>
          <div class="filtros">
            <SanteSelecao
              v-model="novo.microrganismo"
              :rotulo="t('sadt.microbiologia.cadastro.microrganismo')"
              :opcoes="[escolha, ...germes]"
              obrigatorio
              data-testid="ponto-germe"
            />
            <SanteSelecao
              v-model="novo.antimicrobiano"
              :rotulo="t('sadt.microbiologia.cadastro.antimicrobiano')"
              :opcoes="opcoesAm"
              obrigatorio
              data-testid="ponto-am"
            />
            <SanteSelecao
              v-model="novo.material"
              :rotulo="t('sadt.microbiologia.cadastro.material')"
              :opcoes="[qualquer, ...materiais]"
            />
            <SanteSelecao
              v-model="novo.metodo"
              :rotulo="t('sadt.microbiologia.cadastro.metodo')"
              :opcoes="opcoesMetodoPonto"
              data-testid="ponto-metodo"
            />
            <SanteSelecao
              v-model="novo.norma"
              :rotulo="t('sadt.microbiologia.cadastro.norma')"
              :opcoes="opcoesNorma"
            />
            <span class="campo">
              <label for="ponto-versao">{{ t('sadt.microbiologia.cadastro.versaoNorma') }}</label>
              <input id="ponto-versao" v-model="novo.versaoNorma" maxlength="30" data-testid="ponto-versao" />
            </span>
          </div>
          <div class="filtros">
            <template v-if="novo.metodo === 'concentracao_inibitoria'">
              <span class="campo">
                <label for="ponto-s">{{ t('sadt.microbiologia.cadastro.sensivelAte') }}</label>
                <input id="ponto-s" v-model="novo.sensivelAte" inputmode="decimal" data-testid="ponto-s" />
              </span>
              <span class="campo">
                <label for="ponto-r">{{ t('sadt.microbiologia.cadastro.resistenteAcima') }}</label>
                <input
                  id="ponto-r"
                  v-model="novo.resistenteAcima"
                  inputmode="decimal"
                  data-testid="ponto-r"
                />
              </span>
            </template>
            <template v-else>
              <span class="campo">
                <label for="ponto-hs">{{ t('sadt.microbiologia.cadastro.haloSensivel') }}</label>
                <input id="ponto-hs" v-model="novo.haloSensivelMinimo" inputmode="decimal" />
              </span>
              <span class="campo">
                <label for="ponto-hr">{{ t('sadt.microbiologia.cadastro.haloResistente') }}</label>
                <input id="ponto-hr" v-model="novo.haloResistenteMaximo" inputmode="decimal" />
              </span>
            </template>
            <span class="campo">
              <label for="ponto-inicio">{{ t('sadt.microbiologia.cadastro.vigenciaInicio') }}</label>
              <input id="ponto-inicio" v-model="novo.vigenciaInicio" type="date" data-testid="ponto-inicio" />
            </span>
          </div>
          <p v-if="recusaPonto" role="alert" data-testid="ponto-recusa">{{ recusaPonto }}</p>
          <SanteBotao
            :rotulo="t('sadt.microbiologia.cadastro.gravarPonto')"
            :desabilitado="ocupado || !!recusaPonto"
            data-testid="ponto-gravar"
            @acionar="gravarPonto"
          />
        </form>
      </section>
    </template>
    <p v-if="mensagem" role="status" data-testid="antibiograma-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
