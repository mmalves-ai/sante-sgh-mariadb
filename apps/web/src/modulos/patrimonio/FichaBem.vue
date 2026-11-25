<script setup lang="ts">
// Ficha do bem: documento de origem (nota com o item, ou termo de doação), valores com a conferência impressa (contábil =
// valor − acumulada), local e responsável, etiqueta ZPL com o QR, alteração pela versão lida (os campos da depreciação
// só antes da primeira cota: o servidor confere), movimentos do bem e a baixa (`patrimonio.bem.baixar`, crítica: termo
// e a senha de novo). Transferir, emprestar e devolver abrem na tela dos movimentos com o bem já escolhido.
import { type ApoioPatrimonio, type GrupoBem } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import SenhaConfirmacao from '../administracao/componentes/SenhaConfirmacao.vue';
import {
  alterarBem,
  baixarBem,
  lerBem,
  lerEtiqueta,
  lerMovimentos,
  urlTermoBaixa,
} from './api-patrimonio.js';
import {
  baixarTexto,
  centavosOuZero,
  corpoDaAlteracao,
  dataBr,
  instante,
  nomeDoGrupo,
  problemasDaAlteracao,
  rascunhoDoBem,
  type RascunhoAlteracao,
  reais,
  rotuloCentro,
  rotuloCompetencia,
} from './comum-patrimonio.js';
import AgregacoesBem from './AgregacoesBem.vue';
import AjustesBem from './AjustesBem.vue';
import ErroPatrimonio from './ErroPatrimonio.vue';

const props = defineProps<{ id: number; apoio: ApoioPatrimonio; hoje: string }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();

const consulta = useQuery({
  queryKey: computed(() => ['patrimonio', 'bem', props.id]),
  queryFn: () => lerBem(props.id),
});
const b = computed(() => consulta.data.value ?? null);
const movimentos = useQuery({
  queryKey: computed(() => ['patrimonio', 'movimentos', 'bem', props.id]),
  queryFn: () => lerMovimentos({ bem: props.id }),
  retry: false,
});

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// ── Etiqueta ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function etiqueta() {
  erro.value = null;
  try {
    const e = await lerEtiqueta(props.id);
    baixarTexto(`etiqueta-${e.plaqueta}.zpl`, e.zpl);
  } catch (x) {
    erro.value = x;
  }
}

// ── Alteração ───────────────────────────────────────────────────────────────────────────────────────────────────────
const editando = ref(false);
const r = ref<RascunhoAlteracao | null>(null);
watch(
  b,
  (x) => {
    if (x && !editando.value) r.value = rascunhoDoBem(x);
  },
  { immediate: true },
);
const problemasAlt = computed(() => (r.value ? problemasDaAlteracao(r.value) : []));
const podeAlterar = computed(() => props.apoio.acoes.cadastrar && b.value?.situacao !== 'baixado');
// Revisão W0-08: só os grupos ativos, mais o grupo inativo que o bem já tem (marcado), para a alteração não abrir
// com o grupo em branco; o servidor recusa trocar para grupo inativo.
const opcoesGrupo = computed(() =>
  props.apoio.grupos
    .filter((g) => g.ativo || g.valor === b.value?.grupo)
    .map((g) => ({
      valor: g.valor as GrupoBem,
      rotulo: g.ativo ? g.rotulo : `${g.rotulo} (${t('patrimonio.gruposBem.marcaInativo')})`,
    })),
);
const opcoesTipoResp = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...props.apoio.tiposResponsavel.map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesCoef = computed(() => [
  { valor: null as number | null, rotulo: t('patrimonio.ficha.umTurno') },
  ...props.apoio.coeficientes.map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.descricao} (${c.percentual}%)`,
  })),
]);
async function gravarAlteracao() {
  if (!b.value || !r.value || problemasAlt.value.length > 0) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x = await alterarBem(b.value.id, corpoDaAlteracao(r.value, b.value.versao));
    mensagem.value = x.mudou ? t('patrimonio.ficha.alterado') : t('patrimonio.ficha.semMudanca');
    editando.value = false;
    cliente.setQueryData(['patrimonio', 'bem', props.id], x.bem);
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'bens'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Baixa ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const baixando = ref(false);
const baixa = ref({ data: props.hoje as string | null, motivo: '', termo: '', venda: '' });
const senha = ref('');
const podeBaixar = computed(
  () => props.apoio.acoes.baixar && b.value?.situacao === 'ativo' && b.value.movimentoPendente === null,
);
const baixaPronta = computed(
  () =>
    !!baixa.value.data &&
    baixa.value.motivo.trim() !== '' &&
    baixa.value.termo.trim() !== '' &&
    centavosOuZero(baixa.value.venda) !== null &&
    senha.value !== '',
);
async function confirmarBaixa() {
  if (!b.value || !baixaPronta.value) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const venda = centavosOuZero(baixa.value.venda) ?? 0;
    const x = await baixarBem(b.value.id, {
      versao: b.value.versao,
      data: baixa.value.data!,
      motivo: baixa.value.motivo.trim(),
      termoNumero: baixa.value.termo.trim(),
      valorVendaCent: venda > 0 ? venda : null,
      senha: senha.value,
    });
    mensagem.value = t('patrimonio.ficha.baixa.feita');
    baixando.value = false;
    cliente.setQueryData(['patrimonio', 'bem', props.id], x.bem);
    await cliente.invalidateQueries({ queryKey: ['patrimonio'] });
  } catch (e) {
    erro.value = e;
  } finally {
    senha.value = '';
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ficha-bem-titulo" data-testid="ficha-bem">
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!b" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <h2 id="ficha-bem-titulo">
        {{ t('patrimonio.ficha.titulo', { plaqueta: b.plaqueta }) }}: {{ b.descricao }}
      </h2>
      <p v-if="mensagem" role="status" class="ok" data-testid="ficha-mensagem">{{ mensagem }}</p>
      <ErroPatrimonio v-if="erro" :erro="erro" />
      <dl class="dados" data-testid="ficha-dados">
        <dt>{{ t('patrimonio.bens.situacao') }}</dt>
        <dd data-testid="ficha-situacao">{{ t(`patrimonio.situacoesBem.${b.situacao}`) }}</dd>
        <dt>{{ t('patrimonio.bens.grupo') }}</dt>
        <dd data-testid="ficha-grupo">{{ nomeDoGrupo(props.apoio.grupos, b.grupo, t) }}</dd>
        <dt>{{ t('patrimonio.ficha.origem') }}</dt>
        <dd>{{ b.origem.nome }}</dd>
        <dt>{{ t('patrimonio.ficha.documento') }}</dt>
        <dd data-testid="ficha-documento">
          <template v-if="b.nota">{{
            t('patrimonio.ficha.nota', {
              numero: b.nota.numero ?? '—',
              serie: b.nota.serie ? `/${b.nota.serie}` : '',
              data: dataBr(b.nota.data),
              fornecedor: b.nota.fornecedor ?? '—',
              item: b.nota.itemNome ?? b.nota.item ?? '—',
            })
          }}</template>
          <template v-else-if="b.termo">{{
            t('patrimonio.ficha.termo', {
              numero: b.termo.numero,
              data: dataBr(b.termo.data),
              doador: b.termo.doador,
            })
          }}</template>
        </dd>
        <dt>{{ t('patrimonio.ficha.aquisicao') }}</dt>
        <dd>{{ dataBr(b.dataAquisicao) }}</dd>
        <dt>{{ t('patrimonio.bens.contabil') }}</dt>
        <dd data-testid="ficha-conferencia">
          {{
            t('patrimonio.ficha.conferencia', {
              contabil: reais(b.contabilCent),
              valor: reais(b.valorCent),
              acumulada: reais(b.acumuladaCent),
              cotas: b.cotas,
              ultima: b.ultimaCompetencia ? rotuloCompetencia(b.ultimaCompetencia) : '—',
            })
          }}
        </dd>
        <dt>{{ t('patrimonio.ficha.vidaUtil') }}</dt>
        <dd>{{ t('patrimonio.ficha.meses', { n: b.vidaUtilMeses }) }}</dd>
        <dt>{{ t('patrimonio.ficha.residual') }}</dt>
        <dd>{{ reais(b.residualCent) }}</dd>
        <dt>{{ t('patrimonio.ficha.coeficiente') }}</dt>
        <dd>
          {{
            b.coeficiente
              ? `${b.coeficiente.descricao} (${b.coeficiente.percentual}%)`
              : t('patrimonio.ficha.umTurno')
          }}
        </dd>
        <dt>{{ t('patrimonio.ficha.inicio') }}</dt>
        <dd>{{ rotuloCompetencia(b.inicioDepreciacao) }}</dd>
        <dt>{{ t('patrimonio.ficha.depreciavel') }}</dt>
        <dd>{{ b.depreciavel ? t('patrimonio.sim') : t('patrimonio.nao') }}</dd>
        <dt>{{ t('patrimonio.setor') }}</dt>
        <dd>{{ rotuloCentro(b.centro) }}{{ b.localDetalhe ? ` (${b.localDetalhe})` : '' }}</dd>
        <dt>{{ t('patrimonio.ficha.responsavel') }}</dt>
        <dd>
          {{
            b.responsavel ? `${b.responsavel}${b.tipoResponsavel ? ` (${b.tipoResponsavel.nome})` : ''}` : '—'
          }}
        </dd>
        <dt>{{ t('patrimonio.ficha.marcaModelo') }}</dt>
        <dd>{{ [b.marca, b.modelo].filter(Boolean).join(' / ') || '—' }}</dd>
        <dt>{{ t('patrimonio.ficha.serie') }}</dt>
        <dd>{{ b.numeroSerie ?? '—' }}</dd>
        <template v-if="b.baixadoEm">
          <dt>{{ t('patrimonio.ficha.baixadoEm') }}</dt>
          <dd>{{ dataBr(b.baixadoEm) }}</dd>
        </template>
        <template v-if="b.movimentoPendente">
          <dt>{{ t('patrimonio.movimentos.situacao') }}</dt>
          <dd>
            {{
              t('patrimonio.bens.pendente', {
                tipo: t(`patrimonio.tiposMovimento.${b.movimentoPendente.tipo}`),
              })
            }}
          </dd>
        </template>
      </dl>
      <p class="secundario">
        {{ t('patrimonio.ficha.versao', { por: b.alteradoPor, em: instante(b.alteradoEm) }) }}
      </p>

      <div class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('patrimonio.ficha.baixarEtiqueta')"
          data-testid="ficha-etiqueta"
          @acionar="etiqueta"
        />
        <SanteBotao
          v-if="podeAlterar && !editando"
          variante="secundario"
          :rotulo="t('patrimonio.ficha.alterar')"
          data-testid="ficha-alterar"
          @acionar="
            editando = true;
            r = rascunhoDoBem(b);
            mensagem = null;
          "
        />
        <a
          v-if="b.situacao === 'baixado'"
          :href="urlTermoBaixa(b.id)"
          data-testid="ficha-termo-baixa"
          download
          >{{ t('patrimonio.ficha.termoBaixa') }}</a
        >
        <RouterLink
          v-if="apoio.acoes.registrar && b.situacao !== 'baixado'"
          :to="`/patrimonio/movimentos?bem=${b.id}`"
          data-testid="ficha-movimentar"
          >{{ t('patrimonio.ficha.movimentar') }}</RouterLink
        >
        <SanteBotao
          v-if="podeBaixar && !baixando"
          variante="secundario"
          :rotulo="t('patrimonio.ficha.baixar')"
          data-testid="ficha-baixar"
          @acionar="
            baixando = true;
            mensagem = null;
          "
        />
        <SanteBotao
          variante="texto"
          :rotulo="t('patrimonio.fechar')"
          data-testid="ficha-fechar"
          @acionar="emit('fechar')"
        />
      </div>
      <p class="secundario">{{ t('patrimonio.ficha.etiquetaAjuda') }}</p>

      <form
        v-if="editando && r"
        class="bloco"
        data-testid="ficha-form-alterar"
        @submit.prevent="gravarAlteracao"
      >
        <h3>{{ t('patrimonio.ficha.alterar') }}</h3>
        <p class="secundario">{{ t('patrimonio.ficha.depreciacaoTravada') }}</p>
        <div class="campos">
          <SanteCampoTexto
            v-model="r.descricao"
            :rotulo="t('patrimonio.bens.descricaoBem')"
            :max-bytes="120"
            obrigatorio
            data-testid="alterar-descricao"
          />
          <SanteSelecao
            v-model="r.grupo"
            :rotulo="t('patrimonio.bens.grupo')"
            :opcoes="opcoesGrupo"
            busca
            data-testid="alterar-grupo"
          />
          <SanteCampoTexto
            v-model="r.localDetalhe"
            :rotulo="t('patrimonio.cadastro.localDetalhe')"
            :max-bytes="80"
          />
          <SanteSelecao
            v-model="r.tipoResponsavel"
            :rotulo="t('patrimonio.cadastro.tipoResponsavel')"
            :opcoes="opcoesTipoResp"
            busca
          />
          <SanteCampoTexto
            v-model="r.responsavel"
            :rotulo="t('patrimonio.cadastro.responsavel')"
            :max-bytes="80"
            data-testid="alterar-responsavel"
          />
          <SanteCampoTexto v-model="r.marca" :rotulo="t('patrimonio.cadastro.marca')" :max-bytes="40" />
          <SanteCampoTexto v-model="r.modelo" :rotulo="t('patrimonio.cadastro.modelo')" :max-bytes="40" />
          <SanteCampoTexto
            v-model="r.numeroSerie"
            :rotulo="t('patrimonio.cadastro.numeroSerie')"
            :max-bytes="40"
          />
          <SanteCampoTexto
            v-model="r.vidaUtilMeses"
            :rotulo="t('patrimonio.ficha.vidaUtil')"
            :max-bytes="4"
            data-testid="alterar-vida-util"
          />
          <SanteCampoTexto v-model="r.residual" :rotulo="t('patrimonio.ficha.residual')" :max-bytes="20" />
          <SanteSelecao
            v-model="r.coeficiente"
            :rotulo="t('patrimonio.cadastro.coeficiente')"
            :opcoes="opcoesCoef"
          />
          <SanteCampoTexto
            v-model="r.inicioDepreciacao"
            :rotulo="t('patrimonio.ficha.inicio')"
            :max-bytes="7"
          />
          <label class="marca">
            <input v-model="r.depreciavel" type="checkbox" data-testid="alterar-depreciavel" />
            {{ t('patrimonio.ficha.depreciavel') }}
          </label>
        </div>
        <ul v-if="problemasAlt.length > 0" class="erro" data-testid="alterar-problemas">
          <li v-for="p in problemasAlt" :key="p">{{ t(`patrimonio.cadastro.problemas.${p}`) }}</li>
        </ul>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="editando = false" />
          <SanteBotao
            tipo="submit"
            :rotulo="t('patrimonio.gravar')"
            :desabilitado="ocupado || problemasAlt.length > 0"
            data-testid="alterar-gravar"
          />
        </div>
      </form>

      <form v-if="baixando" class="bloco" data-testid="ficha-form-baixa" @submit.prevent>
        <h3>{{ t('patrimonio.ficha.baixa.titulo') }}</h3>
        <p class="secundario">{{ t('patrimonio.ficha.baixa.ajuda') }}</p>
        <div class="campos">
          <SanteData
            v-model="baixa.data"
            :rotulo="t('patrimonio.data')"
            editavel
            :maximo="hoje"
            data-testid="baixa-data"
          />
          <SanteCampoTexto
            v-model="baixa.termo"
            :rotulo="t('patrimonio.ficha.baixa.termo')"
            :max-bytes="40"
            obrigatorio
            data-testid="baixa-termo"
          />
          <SanteCampoTexto
            v-model="baixa.venda"
            :rotulo="t('patrimonio.ficha.baixa.venda')"
            :max-bytes="20"
            data-testid="baixa-venda"
          />
          <SanteCampoTexto
            v-model="baixa.motivo"
            :rotulo="t('patrimonio.motivo')"
            :max-bytes="400"
            multilinha
            obrigatorio
            data-testid="baixa-motivo"
          />
        </div>
        <SenhaConfirmacao v-model="senha" testid="baixa-senha" />
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('patrimonio.cancelar')" @acionar="baixando = false" />
          <SanteBotao
            variante="destrutivo"
            :rotulo="t('patrimonio.ficha.baixa.confirmar')"
            :confirmacao="t('patrimonio.ficha.baixa.ajuda')"
            :desabilitado="ocupado || !baixaPronta"
            data-testid="baixa-confirmar"
            @acionar="confirmarBaixa"
          />
        </div>
      </form>

      <AjustesBem :bem="b" :pode-ajustar="apoio.acoes.calcular" />
      <AgregacoesBem :bem="b" :pode-agregar="apoio.acoes.cadastrar" :hoje="hoje" />

      <h3>{{ t('patrimonio.ficha.historico') }}</h3>
      <p v-if="movimentos.isError.value" class="secundario">—</p>
      <p v-else-if="!movimentos.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
      <p v-else-if="movimentos.data.value.length === 0" class="secundario">
        {{ t('patrimonio.movimentos.nenhum') }}
      </p>
      <ul v-else data-testid="ficha-movimentos">
        <li v-for="m in movimentos.data.value" :key="m.id">
          {{ dataBr(m.data) }}: {{ t(`patrimonio.tiposMovimento.${m.tipo}`) }} ({{
            t(`patrimonio.situacoesMovimento.${m.situacao}`)
          }}) {{ rotuloCentro(m.origem) }}{{ m.destino ? ` → ${rotuloCentro(m.destino)}` : ''
          }}{{ m.terceiro ? ` → ${m.terceiro}` : '' }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
