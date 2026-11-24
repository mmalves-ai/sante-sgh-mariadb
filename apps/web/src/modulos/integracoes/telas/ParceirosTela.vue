<script setup lang="ts">
// Parceiros externos (M34; ficha, seção 7, regras 12, 16): `/admin/integracoes/parceiros`. Quem lê o banco (as visões
// dos parceiros: existência e contagem, nunca conteúdo) com o canal novo a oferecer na ordem da regra 16; as
// integrações novas com o cliente, os escopos, os eventos, a finalidade e a base legal; cadastrar (o segredo sai uma
// vez), ativar ou desativar com o motivo, trocar a credencial e a mensagem de teste (`integracao.parceiro.editar`).
// M59-F3: a vista "Credenciais guardadas no banco" (?vista=credenciais), para quem tem integracao.segredoLegado.ler.
import {
  PERMISSOES_M59_CODIGOS,
  BASES_LEGAIS,
  ESCOPOS_PARCEIRO,
  EVENTOS_INTEGRACAO,
  type ParceiroLido,
  TIPOS_PARCEIRO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  alterarParceiro,
  criarParceiro,
  lerParceiros,
  mensagemDeTeste,
  trocarCredencial,
} from '../api-integracoes.js';
import SegredosParceiros from '../componentes/SegredosParceiros.vue';
import PacotesParceiroPainel from '../componentes/PacotesParceiroPainel.vue';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const podeCredenciais = pode(PERMISSOES_M59_CODIGOS.segredoLegadoLer);
type Vista = 'parceiros' | 'credenciais';
const vista = computed<Vista>({
  get: () => (rota.query['vista'] === 'credenciais' && podeCredenciais ? 'credenciais' : 'parceiros'),
  set: (v) => void roteador.replace({ query: { ...rota.query, vista: v === 'credenciais' ? v : undefined } }),
});
const opcoesVista = computed(() => [
  { valor: 'parceiros' as const, rotulo: t('segredos.parceiros.abaCadastro') },
  { valor: 'credenciais' as const, rotulo: t('segredos.parceiros.aba') },
]);
const cliente = useQueryClient();
const podeEditar = pode('integracao.parceiro.editar');
const parceiros = useQuery({ queryKey: ['integracoes', 'parceiros'], queryFn: () => lerParceiros() });
const novo = reactive({
  codigo: '',
  nome: '',
  tipo: 'apoio',
  canal: '',
  escopos: [] as string[],
  eventos: [] as string[],
  limite: '6',
  finalidade: '',
  baseLegal: 'tutela-da-saude',
});
const erro = ref<unknown>(null);
const segredo = ref<string | null>(null);
const aviso = ref<string | null>(null);
const mudando = ref<ParceiroLido | null>(null);
const motivo = ref('');

async function cadastrar(): Promise<void> {
  erro.value = null;
  segredo.value = null;
  try {
    const r = await criarParceiro({
      codigo: novo.codigo,
      nome: novo.nome,
      tipo: novo.tipo,
      canal: novo.canal || null,
      escopos: novo.escopos,
      eventos: novo.eventos,
      limiteTentativas: Number(novo.limite),
      finalidade: novo.finalidade,
      baseLegal: novo.baseLegal,
    });
    segredo.value = t('integracoes.parceiros.segredo', {
      cliente: r.credencial.clienteId,
      segredo: r.credencial.segredo,
    });
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'parceiros'] });
  } catch (e) {
    erro.value = e;
  }
}

async function mudarAtivo(): Promise<void> {
  const p = mudando.value;
  if (!p) return;
  erro.value = null;
  try {
    await alterarParceiro(p.codigo, {
      nome: p.nome,
      canal: p.canal,
      escopos: p.escopos,
      eventos: p.eventos,
      limiteTentativas: p.limiteTentativas,
      finalidade: p.finalidade,
      baseLegal: p.baseLegal,
      ativo: !p.ativo,
      motivo: motivo.value,
    });
    mudando.value = null;
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['integracoes', 'parceiros'] });
  } catch (e) {
    erro.value = e;
  }
}

async function credencial(codigo: string): Promise<void> {
  erro.value = null;
  try {
    const c = await trocarCredencial(codigo);
    segredo.value = t('integracoes.parceiros.segredo', { cliente: c.clienteId, segredo: c.segredo });
  } catch (e) {
    erro.value = e;
  }
}

async function teste(codigo: string): Promise<void> {
  erro.value = null;
  try {
    await mensagemDeTeste(codigo);
    aviso.value = t('integracoes.parceiros.testeEnviado');
  } catch (e) {
    erro.value = e;
  }
}

const opTipos = computed(() =>
  TIPOS_PARCEIRO.map((x) => ({ valor: x, rotulo: t(`integracoes.parceiros.tipos.${x}`) })),
);
const opBases = computed(() =>
  BASES_LEGAIS.map((x) => ({ valor: x, rotulo: t(`integracoes.parceiros.basesLegais.${x}`) })),
);
const marcar = (lista: string[], v: string, ligado: boolean) => {
  const i = lista.indexOf(v);
  if (ligado && i < 0) lista.push(v);
  if (!ligado && i >= 0) lista.splice(i, 1);
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="parceiros-titulo" data-testid="tela-parceiros">
    <h1 id="parceiros-titulo">{{ t('integracoes.parceiros.titulo') }}</h1>
    <p>{{ t('integracoes.parceiros.texto') }}</p>
    <SanteOpcoes
      v-if="podeCredenciais"
      v-model="vista"
      :legenda="t('segredos.parceiros.vistas')"
      :opcoes="opcoesVista"
      nome="parceiros-vista"
      data-testid="parceiros-vista"
    />
    <SegredosParceiros v-if="vista === 'credenciais'" />
    <MensagemErro v-else-if="parceiros.isError.value" :erro="parceiros.error.value" />
    <p v-else-if="!parceiros.data.value" role="status">{{ t('integracoes.carregando') }}</p>
    <template v-else>
      <section class="painel" aria-labelledby="leem-titulo">
        <h2 id="leem-titulo">{{ t('integracoes.parceiros.leem') }}</h2>
        <table class="tabela" data-testid="tabela-visoes">
          <caption>
            {{
              t('integracoes.parceiros.leem')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('integracoes.parceiros.nome') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.visao') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.existe') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.linhas') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.oferta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in parceiros.data.value.leemOBanco" :key="v.visao">
              <td>{{ v.parceiro }}</td>
              <td>{{ v.visao }}</td>
              <td>{{ v.existe ? '✓' : '—' }}</td>
              <td>{{ v.linhas ?? t('integracoes.naoMedido') }}</td>
              <td>{{ v.oferta.map((o) => t(`integracoes.parceiros.ofertas.${o}`)).join(' → ') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="painel" aria-labelledby="novos-titulo">
        <h2 id="novos-titulo">{{ t('integracoes.parceiros.novos') }}</h2>
        <div v-if="segredo" role="alert" data-testid="parceiro-segredo">
          <SanteAlerta variante="info" :texto="segredo" />
        </div>
        <p v-if="aviso" role="status">{{ aviso }}</p>
        <MensagemErro v-if="erro" :erro="erro" />
        <table class="tabela" data-testid="tabela-parceiros">
          <caption>
            {{
              t('integracoes.parceiros.novos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('integracoes.parceiros.codigo') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.tipo') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.eventos') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.finalidade') }}</th>
              <th scope="col">{{ t('integracoes.parceiros.credencial') }}</th>
              <th v-if="podeEditar" scope="col">{{ t('integracoes.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in parceiros.data.value.novos" :key="p.codigo" :data-testid="`parceiro-${p.codigo}`">
              <td>
                {{ p.nome }}
                <span class="secundario"
                  >{{ p.codigo }} ·
                  {{ p.ativo ? t('integracoes.parceiros.ativo') : t('integracoes.parceiros.inativo') }}</span
                >
              </td>
              <td>
                {{ t(`integracoes.parceiros.tipos.${p.tipo}`)
                }}<span v-if="p.canal" class="secundario">{{ p.canal }}</span>
              </td>
              <td>{{ p.eventos.join(', ') || '—' }}</td>
              <td>
                {{ p.finalidade
                }}<span class="secundario">{{ t(`integracoes.parceiros.basesLegais.${p.baseLegal}`) }}</span>
              </td>
              <td>
                {{
                  p.temSegredo ? t('integracoes.parceiros.comSegredo') : t('integracoes.parceiros.semSegredo')
                }}
              </td>
              <td v-if="podeEditar">
                <SanteBotao
                  variante="texto"
                  :rotulo="p.ativo ? t('integracoes.parceiros.desativar') : t('integracoes.parceiros.ativar')"
                  @acionar="mudando = p"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('integracoes.parceiros.trocarCredencial')"
                  @acionar="credencial(p.codigo)"
                />
                <SanteBotao
                  variante="texto"
                  :rotulo="t('integracoes.parceiros.teste')"
                  :desabilitado="!p.ativo"
                  @acionar="teste(p.codigo)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="mudando" class="formulario" @submit.prevent="mudarAtivo">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('integracoes.parceiros.motivoMudanca')"
            :max-bytes="200"
            obrigatorio
          />
          <SanteBotao
            tipo="submit"
            :rotulo="mudando.ativo ? t('integracoes.parceiros.desativar') : t('integracoes.parceiros.ativar')"
          />
          <SanteBotao variante="texto" :rotulo="t('integracoes.cancelar')" @acionar="mudando = null" />
        </form>
        <form v-if="podeEditar" class="formulario" data-testid="parceiro-novo" @submit.prevent="cadastrar">
          <h3>{{ t('integracoes.parceiros.novo') }}</h3>
          <span class="campo">
            <label for="parc-codigo">{{ t('integracoes.parceiros.codigo') }}</label>
            <input id="parc-codigo" v-model="novo.codigo" maxlength="40" required />
          </span>
          <SanteCampoTexto
            v-model="novo.nome"
            :rotulo="t('integracoes.parceiros.nome')"
            :max-bytes="80"
            obrigatorio
          />
          <SanteSelecao v-model="novo.tipo" :rotulo="t('integracoes.parceiros.tipo')" :opcoes="opTipos" />
          <span class="campo">
            <label for="parc-canal">{{ t('integracoes.parceiros.canal') }}</label>
            <input id="parc-canal" v-model="novo.canal" maxlength="60" />
          </span>
          <fieldset>
            <legend>{{ t('integracoes.parceiros.escopos') }}</legend>
            <label v-for="e in ESCOPOS_PARCEIRO" :key="e">
              <input
                type="checkbox"
                :checked="novo.escopos.includes(e)"
                @change="marcar(novo.escopos, e, ($event.target as HTMLInputElement).checked)"
              />
              {{ e }}
            </label>
          </fieldset>
          <fieldset>
            <legend>{{ t('integracoes.parceiros.eventos') }}</legend>
            <label v-for="e in EVENTOS_INTEGRACAO" :key="e">
              <input
                type="checkbox"
                :checked="novo.eventos.includes(e)"
                @change="marcar(novo.eventos, e, ($event.target as HTMLInputElement).checked)"
              />
              {{ e }}
            </label>
          </fieldset>
          <span class="campo">
            <label for="parc-limite">{{ t('integracoes.parceiros.limite') }}</label>
            <input id="parc-limite" v-model="novo.limite" type="number" min="1" max="20" />
          </span>
          <SanteCampoTexto
            v-model="novo.finalidade"
            :rotulo="t('integracoes.parceiros.finalidade')"
            :max-bytes="300"
            obrigatorio
          />
          <SanteSelecao
            v-model="novo.baseLegal"
            :rotulo="t('integracoes.parceiros.baseLegal')"
            :opcoes="opBases"
          />
          <SanteBotao tipo="submit" :rotulo="t('integracoes.parceiros.cadastrar')" />
        </form>
      </section>
    </template>
    <!-- F3.9 (L134): pacotes de dados e entregas agendadas de cada parceiro. -->
    <PacotesParceiroPainel v-if="vista === 'parceiros'" :pode-editar="podeEditar" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
