<script setup lang="ts">
// Aba Soroteca da tela de amostras (F8, 05-SADT linha 9): a amostra lida pela etiqueta mostra na hora o prazo de
// descarte pela regra, onde está guardada e o histórico; guardar vai à posição sugerida do rack (sem contar o rack à
// mão), retirar pede o motivo, a retirada provisória volta com um clique; as vencidas do dia saem num expurgo com
// motivo (só marca o descarte). O cadastro de equipamentos, racks e regras fica no fim. A regra mora no domínio
// (@sgh/dominio-sadt) e o servidor confere tudo de novo.
import { conferirPosicao, primeiraPosicaoLivre, RecusaSoroteca } from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerOpcoesCatalogo } from '../api-limites.js';
import { novaChave } from '../api-sadt.js';
import {
  type AmostraNaSoroteca,
  desativarCadastroSoroteca,
  devolverAmostra,
  expurgarAmostras,
  guardarAmostra,
  incluirEquipamento,
  incluirRegraDescarte,
  incluirSuporte,
  lerAmostraNaSoroteca,
  lerSoroteca,
  retirarAmostra,
} from '../api-soroteca.js';
import { quando } from '../usar-sadt.js';
import ErroSadt from './ErroSadt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['sadt', 'soroteca'], queryFn: lerSoroteca });
const opcoesCatalogo = useQuery({ queryKey: ['sadt', 'catalogo', 'opcoes'], queryFn: lerOpcoesCatalogo });
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const escolha = () => ({ valor: '', rotulo: t('sadt.soroteca.escolha') });
const equipamentos = computed(() => [
  escolha(),
  ...(painel.data.value?.equipamentos ?? [])
    .filter((e) => e.ativo)
    .map((e) => ({ valor: String(e.id), rotulo: `${e.codigo} · ${e.descricao}` })),
]);
const motivos = computed(() => [
  escolha(),
  ...(painel.data.value?.motivos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const motivosExpurgo = computed(() => [
  escolha(),
  ...(painel.data.value?.motivos ?? [])
    .filter((m) => m.finalidade === 'prazo_vencido' || m.finalidade === 'descarte')
    .map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const materiais = computed(() =>
  (['soro', 'plasma', 'sangue_total', 'lamina', 'bloco', 'outro'] as const).map((m) => ({
    valor: m,
    rotulo: t(`sadt.soroteca.materiais.${m}`),
  })),
);

// ── Leitura da amostra ──────────────────────────────────────────────────────────────────────────────────────────
const codigo = ref('');
const amostra = ref<AmostraNaSoroteca | null>(null);
const atual = computed(() => amostra.value?.guardas.find((g) => g.situacao !== 'descartada') ?? null);
async function ler(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    amostra.value = await lerAmostraNaSoroteca(codigo.value.trim());
  } catch (x) {
    amostra.value = null;
    erro.value = x;
  }
}

// ── Guardar ────────────────────────────────────────────────────────────────────────────────────────────────────
const guarda = reactive({ equipamento: '', suporte: '', material: 'soro', linha: '', coluna: '' });
const suportes = computed(() => [
  { valor: '', rotulo: t('sadt.soroteca.semSuporte') },
  ...(painel.data.value?.suportes ?? [])
    .filter((s) => s.ativo && (s.equipamento === null || String(s.equipamento) === guarda.equipamento))
    .map((s) => ({ valor: String(s.id), rotulo: `${s.codigo} · ${s.descricao}` })),
]);
watch(
  () => guarda.equipamento,
  () => {
    guarda.suporte = '';
  },
);
const suporte = computed(
  () => painel.data.value?.suportes.find((s) => String(s.id) === guarda.suporte) ?? null,
);
const sugerida = computed(() =>
  suporte.value ? primeiraPosicaoLivre(suporte.value, suporte.value.ocupadas) : null,
);
// Validação na hora: a posição manual cabe no rack e está livre (a mesma regra do servidor).
const avisoPosicao = computed(() => {
  if (!suporte.value || (!guarda.linha && !guarda.coluna)) return null;
  try {
    conferirPosicao(
      suporte.value,
      { linha: Number(guarda.linha), coluna: Number(guarda.coluna) },
      suporte.value.ocupadas,
    );
    return null;
  } catch (x) {
    return x instanceof RecusaSoroteca ? x.message : String(x);
  }
});
const mapa = computed(() => {
  const s = suporte.value;
  if (!s) return [];
  const ocupadas = new Set(s.ocupadas.map((p) => `${p.linha}:${p.coluna}`));
  return Array.from({ length: s.quantidadeLinhas }, (_, i) =>
    Array.from({ length: s.quantidadeColunas }, (_, j) => ({
      linha: i + 1,
      coluna: j + 1,
      ocupada: ocupadas.has(`${i + 1}:${j + 1}`),
    })),
  );
});
const podeGuardar = computed(
  () =>
    Boolean(amostra.value) &&
    !atual.value &&
    guarda.equipamento !== '' &&
    avisoPosicao.value === null &&
    (!suporte.value || Boolean(guarda.linha && guarda.coluna) || sugerida.value !== null),
);

async function executar(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = await fn();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'soroteca'] });
    if (amostra.value) amostra.value = await lerAmostraNaSoroteca(amostra.value.codigo);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const numOuNulo = (v: string) => (v.trim() === '' ? null : Number(v));

const guardar = () =>
  executar(async () => {
    await guardarAmostra(
      {
        codigo: amostra.value!.codigo,
        equipamento: Number(guarda.equipamento),
        suporte: guarda.suporte ? Number(guarda.suporte) : null,
        tipoMaterial: guarda.material,
        linha: numOuNulo(guarda.linha),
        coluna: numOuNulo(guarda.coluna),
      },
      novaChave('soroteca.guardar'),
    );
    guarda.linha = '';
    guarda.coluna = '';
    return t('sadt.soroteca.guardada', { codigo: amostra.value!.codigo });
  });

// ── Retirar e devolver ─────────────────────────────────────────────────────────────────────────────────────────
const retirada = reactive({ motivo: '', observacao: '' });
const retirar = () =>
  executar(async () => {
    await retirarAmostra(
      atual.value!.id,
      { motivo: Number(retirada.motivo), observacao: retirada.observacao.trim() || null },
      novaChave('soroteca.retirar'),
    );
    retirada.motivo = '';
    retirada.observacao = '';
    return t('sadt.soroteca.retirada');
  });
const devolver = () =>
  executar(async () => {
    await devolverAmostra(atual.value!.id, {}, novaChave('soroteca.devolver'));
    return t('sadt.soroteca.devolvida');
  });

// ── Expurgo ────────────────────────────────────────────────────────────────────────────────────────────────────
const marcadas = ref<number[]>([]);
const motivoExpurgo = ref('');
const expurgar = () =>
  executar(async () => {
    const r = await expurgarAmostras(
      { guardas: marcadas.value, motivo: Number(motivoExpurgo.value) },
      novaChave('soroteca.expurgo'),
    );
    marcadas.value = [];
    return t('sadt.soroteca.expurgadas', { quantas: r.descartadas });
  });

// ── Cadastro ───────────────────────────────────────────────────────────────────────────────────────────────────
const novoEquip = reactive({ codigo: '', descricao: '', tipo: 'geladeira', minima: '', maxima: '' });
const tiposEquipamento = computed(() =>
  (['geladeira', 'freezer', 'ultracongelador', 'nitrogenio', 'armario', 'outro'] as const).map((x) => ({
    valor: x,
    rotulo: t(`sadt.soroteca.tiposEquipamento.${x}`),
  })),
);
const incluirEquip = () =>
  executar(async () => {
    await incluirEquipamento(
      {
        codigo: novoEquip.codigo.trim(),
        descricao: novoEquip.descricao.trim(),
        tipo: novoEquip.tipo,
        temperaturaMinima: numOuNulo(novoEquip.minima),
        temperaturaMaxima: numOuNulo(novoEquip.maxima),
      },
      novaChave('soroteca.equipamento'),
    );
    Object.assign(novoEquip, { codigo: '', descricao: '', minima: '', maxima: '' });
    return t('sadt.soroteca.incluido');
  });
const novoSup = reactive({ equipamento: '', codigo: '', descricao: '', linhas: '10', colunas: '10' });
const incluirSup = () =>
  executar(async () => {
    await incluirSuporte(
      {
        equipamento: Number(novoSup.equipamento),
        codigo: novoSup.codigo.trim(),
        descricao: novoSup.descricao.trim(),
        quantidadeLinhas: Number(novoSup.linhas),
        quantidadeColunas: Number(novoSup.colunas),
      },
      novaChave('soroteca.suporte'),
    );
    Object.assign(novoSup, { codigo: '', descricao: '' });
    return t('sadt.soroteca.incluido');
  });
const novaRegra = reactive({
  descricao: '',
  abrangencia: 'geral',
  exame: '',
  comparador: '',
  valor: '',
  dias: '',
  prioridade: '0',
});
const abrangencias = computed(() =>
  (['geral', 'exame', 'resultado'] as const).map((x) => ({
    valor: x,
    rotulo: t(`sadt.soroteca.abrangencias.${x}`),
  })),
);
const comparadores = computed(() => [
  escolha(),
  ...(['igual', 'diferente', 'menor', 'menor_igual', 'maior', 'maior_igual', 'entre', 'contem'] as const).map(
    (x) => ({
      valor: x,
      rotulo: t(`sadt.soroteca.comparadores.${x}`),
    }),
  ),
]);
const exames = computed(() => [
  escolha(),
  ...(opcoesCatalogo.data.value?.exames ?? []).map((e) => ({ valor: String(e.id), rotulo: e.nome })),
]);
const regraCompleta = computed(
  () =>
    novaRegra.descricao.trim() !== '' &&
    Number(novaRegra.dias) >= 1 &&
    (novaRegra.abrangencia === 'geral' || novaRegra.exame !== '') &&
    (novaRegra.abrangencia !== 'resultado' || (novaRegra.comparador !== '' && novaRegra.valor.trim() !== '')),
);
const incluirRegra = () =>
  executar(async () => {
    const usaExame = novaRegra.abrangencia !== 'geral';
    const peloResultado = novaRegra.abrangencia === 'resultado';
    await incluirRegraDescarte(
      {
        descricao: novaRegra.descricao.trim(),
        abrangencia: novaRegra.abrangencia,
        exame: usaExame ? Number(novaRegra.exame) : null,
        comparador: peloResultado ? novaRegra.comparador : null,
        valorTexto: peloResultado ? novaRegra.valor.trim() : null,
        diasGuarda: Number(novaRegra.dias),
        prioridade: Number(novaRegra.prioridade || 0),
      },
      novaChave('soroteca.regra'),
    );
    Object.assign(novaRegra, { descricao: '', exame: '', comparador: '', valor: '', dias: '' });
    return t('sadt.soroteca.incluido');
  });
const desativar = (tipo: 'equipamento' | 'suporte' | 'regra', id: number) =>
  executar(async () => {
    await desativarCadastroSoroteca(tipo, id, novaChave(`soroteca.desativar.${tipo}`));
    return t('sadt.soroteca.desativado');
  });
const nomeExame = (id: number | null) =>
  id === null ? '' : (opcoesCatalogo.data.value?.exames.find((e) => e.id === id)?.nome ?? `#${id}`);
</script>

<template>
  <section class="painel" aria-labelledby="soroteca-titulo" data-testid="soroteca">
    <h2 id="soroteca-titulo">{{ t('sadt.soroteca.titulo') }}</h2>
    <p>{{ t('sadt.soroteca.texto') }}</p>
    <ErroSadt v-if="painel.isError.value" :erro="painel.error.value" />

    <div class="filtros">
      <span class="campo">
        <label for="soroteca-codigo">{{ t('sadt.soroteca.codigo') }}</label>
        <input id="soroteca-codigo" v-model="codigo" data-testid="soroteca-codigo" @keyup.enter="ler" />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('sadt.soroteca.ler')"
        data-testid="soroteca-ler"
        @acionar="ler"
      />
    </div>

    <div v-if="amostra" class="painel" data-testid="soroteca-amostra">
      <h3>{{ amostra.codigo }}</h3>
      <p>{{ t('sadt.soroteca.situacaoAmostra', { situacao: amostra.situacao }) }}</p>
      <p v-if="!atual" data-testid="soroteca-prazo">
        {{
          amostra.prazo.descarteSeGuardarHoje
            ? t('sadt.soroteca.prazoRegra', {
                data: amostra.prazo.descarteSeGuardarHoje,
                dias: amostra.prazo.dias,
              })
            : t('sadt.soroteca.semRegra')
        }}
      </p>

      <template v-if="!atual">
        <div class="filtros">
          <SanteSelecao
            v-model="guarda.equipamento"
            :rotulo="t('sadt.soroteca.equipamento')"
            :opcoes="equipamentos"
            data-testid="soroteca-equipamento"
          />
          <SanteSelecao
            v-model="guarda.suporte"
            :rotulo="t('sadt.soroteca.suporte')"
            :opcoes="suportes"
            :desabilitado="!guarda.equipamento"
            data-testid="soroteca-suporte"
          />
          <SanteSelecao
            v-model="guarda.material"
            :rotulo="t('sadt.soroteca.material')"
            :opcoes="materiais"
            data-testid="soroteca-material"
          />
        </div>
        <template v-if="suporte">
          <p role="status" data-testid="soroteca-sugerida">
            {{
              sugerida
                ? t('sadt.soroteca.sugerida', { linha: sugerida.linha, coluna: sugerida.coluna })
                : t('sadt.soroteca.cheio')
            }}
          </p>
          <details>
            <summary>{{ t('sadt.soroteca.posicaoManual') }}</summary>
            <div class="filtros">
              <span class="campo">
                <label for="soroteca-linha">{{ t('sadt.soroteca.linha') }}</label>
                <input
                  id="soroteca-linha"
                  v-model="guarda.linha"
                  inputmode="numeric"
                  data-testid="soroteca-linha"
                />
              </span>
              <span class="campo">
                <label for="soroteca-coluna">{{ t('sadt.soroteca.coluna') }}</label>
                <input
                  id="soroteca-coluna"
                  v-model="guarda.coluna"
                  inputmode="numeric"
                  data-testid="soroteca-coluna"
                />
              </span>
            </div>
            <p v-if="avisoPosicao" role="alert" data-testid="soroteca-aviso-posicao">{{ avisoPosicao }}</p>
            <table :aria-label="t('sadt.soroteca.mapa')" data-testid="soroteca-mapa">
              <tbody>
                <tr v-for="(linhaMapa, i) in mapa" :key="i">
                  <td v-for="c in linhaMapa" :key="c.coluna">
                    {{ c.linha }}-{{ c.coluna }}:
                    {{ c.ocupada ? t('sadt.soroteca.ocupada') : t('sadt.soroteca.livre') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </details>
        </template>
        <SanteBotao
          :rotulo="t('sadt.soroteca.guardar')"
          :desabilitado="ocupado || !podeGuardar"
          data-testid="soroteca-guardar"
          @acionar="guardar"
        />
      </template>

      <template v-else>
        <p data-testid="soroteca-guarda-atual">
          {{ t(`sadt.soroteca.situacoes.${atual.situacao}`) }} ·
          {{
            t('sadt.soroteca.guardaAtual', {
              equipamento: atual.equipamentoDescricao,
              suporte: atual.suporteCodigo ?? '—',
              linha: atual.linha ?? '—',
              coluna: atual.coluna ?? '—',
              descarte: atual.descartePrevistoEm ?? t('sadt.soroteca.semPrazo'),
            })
          }}
        </p>
        <div v-if="atual.situacao === 'guardada'" class="filtros">
          <SanteSelecao
            v-model="retirada.motivo"
            :rotulo="t('sadt.soroteca.motivo')"
            :opcoes="motivos"
            data-testid="soroteca-motivo-retirada"
          />
          <span class="campo">
            <label for="soroteca-obs">{{ t('sadt.soroteca.observacao') }}</label>
            <input id="soroteca-obs" v-model="retirada.observacao" maxlength="500" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.soroteca.retirar')"
            :desabilitado="ocupado || !retirada.motivo"
            data-testid="soroteca-retirar"
            @acionar="retirar"
          />
        </div>
        <SanteBotao
          v-else
          :rotulo="t('sadt.soroteca.devolver')"
          :desabilitado="ocupado"
          data-testid="soroteca-devolver"
          @acionar="devolver"
        />
      </template>

      <details v-if="amostra.movimentos.length > 0" open>
        <summary>{{ t('sadt.soroteca.historico') }}</summary>
        <ul data-testid="soroteca-historico">
          <li v-for="(mv, i) in amostra.movimentos" :key="i">
            {{ quando(mv.em) }} · {{ t(`sadt.soroteca.movimentos.${mv.tipo}`) }} · {{ mv.por ?? '—'
            }}<template v-if="mv.motivo"> · {{ mv.motivo }}</template>
          </li>
        </ul>
      </details>
      <details v-if="amostra.doPaciente.length > 0">
        <summary>{{ t('sadt.soroteca.doPaciente') }}</summary>
        <ul data-testid="soroteca-do-paciente">
          <li v-for="g in amostra.doPaciente" :key="g.id">
            {{ g.codigo }} · {{ t(`sadt.soroteca.situacoes.${g.situacao}`) }} · {{ g.equipamentoDescricao }}
            {{ g.suporteCodigo ?? '' }}
          </li>
        </ul>
      </details>
    </div>

    <section class="painel" data-testid="soroteca-vencidas">
      <h3>{{ t('sadt.soroteca.vencidas', { quantas: painel.data.value?.vencidas.length ?? 0 }) }}</h3>
      <p v-if="(painel.data.value?.vencidas.length ?? 0) === 0">{{ t('sadt.soroteca.nenhumaVencida') }}</p>
      <template v-else>
        <ul>
          <li v-for="g in painel.data.value?.vencidas ?? []" :key="g.id">
            <label>
              <input
                v-model="marcadas"
                type="checkbox"
                :value="g.id"
                :data-testid="`soroteca-vencida-${g.codigo}`"
              />
              {{ g.codigo }} · {{ g.equipamentoDescricao }} {{ g.suporteCodigo ?? '' }} {{ g.linha ?? '' }}-{{
                g.coluna ?? ''
              }}
              · {{ g.descartePrevistoEm }}
            </label>
          </li>
        </ul>
        <div class="filtros">
          <SanteSelecao
            v-model="motivoExpurgo"
            :rotulo="t('sadt.soroteca.motivo')"
            :opcoes="motivosExpurgo"
            data-testid="soroteca-motivo-expurgo"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('sadt.soroteca.expurgar')"
            :desabilitado="ocupado || marcadas.length === 0 || !motivoExpurgo"
            data-testid="soroteca-expurgar"
            @acionar="expurgar"
          />
        </div>
      </template>
    </section>

    <details class="painel" data-testid="soroteca-cadastro">
      <summary>{{ t('sadt.soroteca.cadastro') }}</summary>
      <h3>{{ t('sadt.soroteca.equipamento') }}</h3>
      <ul>
        <li v-for="e in painel.data.value?.equipamentos ?? []" :key="e.id">
          {{ e.codigo }} · {{ e.descricao }} · {{ t(`sadt.soroteca.tiposEquipamento.${e.tipo}`) }} ·
          {{ t('sadt.soroteca.guardadas', { quantas: e.guardadas }) }}
          <SanteBotao
            v-if="e.ativo"
            variante="secundario"
            :rotulo="t('sadt.soroteca.desativar')"
            :desabilitado="ocupado"
            @acionar="desativar('equipamento', e.id)"
          />
        </li>
      </ul>
      <div class="filtros">
        <span class="campo">
          <label for="equip-codigo">{{ t('sadt.soroteca.codigoCadastro') }}</label>
          <input id="equip-codigo" v-model="novoEquip.codigo" maxlength="30" data-testid="equip-codigo" />
        </span>
        <span class="campo">
          <label for="equip-descricao">{{ t('sadt.soroteca.descricao') }}</label>
          <input
            id="equip-descricao"
            v-model="novoEquip.descricao"
            maxlength="150"
            data-testid="equip-descricao"
          />
        </span>
        <SanteSelecao v-model="novoEquip.tipo" :rotulo="t('sadt.soroteca.tipo')" :opcoes="tiposEquipamento" />
        <span class="campo">
          <label for="equip-min">{{ t('sadt.soroteca.temperaturaMinima') }}</label>
          <input id="equip-min" v-model="novoEquip.minima" inputmode="decimal" />
        </span>
        <span class="campo">
          <label for="equip-max">{{ t('sadt.soroteca.temperaturaMaxima') }}</label>
          <input id="equip-max" v-model="novoEquip.maxima" inputmode="decimal" />
        </span>
        <SanteBotao
          :rotulo="t('sadt.soroteca.incluirEquipamento')"
          :desabilitado="ocupado || !novoEquip.codigo.trim() || !novoEquip.descricao.trim()"
          data-testid="equip-incluir"
          @acionar="incluirEquip"
        />
      </div>

      <h3>{{ t('sadt.soroteca.suporte') }}</h3>
      <ul>
        <li v-for="s in painel.data.value?.suportes ?? []" :key="s.id">
          {{ s.codigo }} · {{ s.descricao }} · {{ `${s.quantidadeLinhas}×${s.quantidadeColunas}` }} ·
          {{ t('sadt.soroteca.guardadas', { quantas: s.ocupadas.length }) }}
          <SanteBotao
            v-if="s.ativo"
            variante="secundario"
            :rotulo="t('sadt.soroteca.desativar')"
            :desabilitado="ocupado"
            @acionar="desativar('suporte', s.id)"
          />
        </li>
      </ul>
      <div class="filtros">
        <SanteSelecao
          v-model="novoSup.equipamento"
          :rotulo="t('sadt.soroteca.equipamento')"
          :opcoes="equipamentos"
        />
        <span class="campo">
          <label for="sup-codigo">{{ t('sadt.soroteca.codigoCadastro') }}</label>
          <input id="sup-codigo" v-model="novoSup.codigo" maxlength="30" />
        </span>
        <span class="campo">
          <label for="sup-descricao">{{ t('sadt.soroteca.descricao') }}</label>
          <input id="sup-descricao" v-model="novoSup.descricao" maxlength="150" />
        </span>
        <span class="campo">
          <label for="sup-linhas">{{ t('sadt.soroteca.linhas') }}</label>
          <input id="sup-linhas" v-model="novoSup.linhas" inputmode="numeric" />
        </span>
        <span class="campo">
          <label for="sup-colunas">{{ t('sadt.soroteca.colunas') }}</label>
          <input id="sup-colunas" v-model="novoSup.colunas" inputmode="numeric" />
        </span>
        <SanteBotao
          :rotulo="t('sadt.soroteca.incluirSuporte')"
          :desabilitado="
            ocupado ||
            !novoSup.equipamento ||
            !novoSup.codigo.trim() ||
            !novoSup.descricao.trim() ||
            Number(novoSup.linhas) < 1 ||
            Number(novoSup.colunas) < 1
          "
          @acionar="incluirSup"
        />
      </div>

      <h3>{{ t('sadt.soroteca.incluirRegra') }}</h3>
      <ul data-testid="soroteca-regras">
        <li v-for="r in painel.data.value?.regras ?? []" :key="r.id">
          {{ r.descricao }} · {{ t(`sadt.soroteca.abrangencias.${r.abrangencia}`) }}
          {{ nomeExame(r.exame) }} · {{ r.diasGuarda }} {{ t('sadt.soroteca.dias').toLowerCase() }}
          <SanteBotao
            v-if="r.ativo"
            variante="secundario"
            :rotulo="t('sadt.soroteca.desativar')"
            :desabilitado="ocupado"
            @acionar="desativar('regra', r.id)"
          />
        </li>
      </ul>
      <div class="filtros">
        <span class="campo">
          <label for="regra-descricao">{{ t('sadt.soroteca.regraDescricao') }}</label>
          <input id="regra-descricao" v-model="novaRegra.descricao" maxlength="255" />
        </span>
        <SanteSelecao
          v-model="novaRegra.abrangencia"
          :rotulo="t('sadt.soroteca.abrangencia')"
          :opcoes="abrangencias"
        />
        <SanteSelecao
          v-if="novaRegra.abrangencia !== 'geral'"
          v-model="novaRegra.exame"
          :rotulo="t('sadt.soroteca.exame')"
          :opcoes="exames"
        />
        <template v-if="novaRegra.abrangencia === 'resultado'">
          <SanteSelecao
            v-model="novaRegra.comparador"
            :rotulo="t('sadt.soroteca.comparador')"
            :opcoes="comparadores"
          />
          <span class="campo">
            <label for="regra-valor">{{ t('sadt.soroteca.valor') }}</label>
            <input id="regra-valor" v-model="novaRegra.valor" maxlength="200" />
          </span>
        </template>
        <span class="campo">
          <label for="regra-dias">{{ t('sadt.soroteca.dias') }}</label>
          <input id="regra-dias" v-model="novaRegra.dias" inputmode="numeric" />
        </span>
        <span class="campo">
          <label for="regra-prioridade">{{ t('sadt.soroteca.prioridade') }}</label>
          <input id="regra-prioridade" v-model="novaRegra.prioridade" inputmode="numeric" />
        </span>
        <SanteBotao
          :rotulo="t('sadt.soroteca.incluirRegra')"
          :desabilitado="ocupado || !regraCompleta"
          @acionar="incluirRegra"
        />
      </div>
    </details>

    <p v-if="mensagem" role="status" data-testid="soroteca-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>
